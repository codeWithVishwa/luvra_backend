import cloudinary from "cloudinary";
import Post from "../models/post.model.js";
import User from "../models/user.model.js";
import Comment from "../models/comment.model.js";
import Notification from "../models/notification.model.js";
import { sendPushNotification } from "../utils/expoPush.js";
import { getOnlineUsers, getSocketIdsForUser } from "../socket.js";

function ensureCloudinaryConfigured() {
  const cfg = cloudinary.v2.config();
  if (!cfg.api_key || !cfg.cloud_name) {
    cloudinary.v2.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }
}

const MAX_VIDEO_SECONDS = 20;
const MAX_MEDIA_PER_POST = 4;

async function getFollowingIds(userId) {
  const user = await User.findById(userId).select("following");
  const ids = new Set();
  if (user && Array.isArray(user.following)) {
    user.following.forEach(id => ids.add(String(id)));
  }
  return ids;
}

function serializePost(post, viewerId) {
  const likes = Array.isArray(post.likes) ? post.likes.map((id) => String(id)) : [];
  return {
    _id: post._id,
    caption: post.caption,
    media: post.media,
    visibility: post.visibility,
    createdAt: post.createdAt,
    commentCount: typeof post.commentCount === "number" ? post.commentCount : 0,
    hideLikeCount: !!post.hideLikeCount,
    commentsDisabled: !!post.commentsDisabled,
    author: post.author
      ? {
          _id: post.author._id,
          name: post.author.name,
          avatarUrl: post.author.avatarUrl,
          isPrivate: post.author.isPrivate,
        }
      : null,
    likeCount: likes.length,
    likedByMe: viewerId ? likes.includes(String(viewerId)) : false,
  };
}

function serializeComment(comment) {
  const parentId = comment.parent ? String(comment.parent._id || comment.parent) : null;
  const parentAuthor = comment.parent && comment.parent.author
    ? {
        _id: comment.parent.author._id,
        name: comment.parent.author.name,
        avatarUrl: comment.parent.author.avatarUrl,
      }
    : null;
  return {
    _id: comment._id,
    text: comment.text,
    createdAt: comment.createdAt,
    author: comment.author
      ? {
          _id: comment.author._id,
          name: comment.author.name,
          avatarUrl: comment.author.avatarUrl,
        }
      : null,
    parentId,
    parentAuthor,
  };
}

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.v2.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

async function canViewPost(viewerId, post) {
  if (!post) return false;
  const authorId = post.author && post.author._id ? post.author._id : post.author;
  if (String(authorId) === String(viewerId)) return true;
  if (post.visibility === "public") return true;
  // For private posts, viewer must be following the author
  const followingIds = await getFollowingIds(viewerId);
  return followingIds.has(String(authorId));
}

export const uploadPostMedia = async (req, res) => {
  try {
    ensureCloudinaryConfigured();
    if (!req.file) return res.status(400).json({ message: "No file provided" });
    const isVideo = req.file.mimetype.startsWith("video/");
    const resourceType = isVideo ? "video" : "image";
    const folder = `flowsnap/posts/${req.user._id}`;
    const result = await uploadBuffer(req.file.buffer, {
      folder,
      resource_type: resourceType,
      overwrite: false,
    });
    if (isVideo && result.duration && result.duration > MAX_VIDEO_SECONDS) {
      await cloudinary.v2.uploader.destroy(result.public_id, { resource_type: "video" }).catch(() => {});
      return res.status(400).json({ message: `Videos must be under ${MAX_VIDEO_SECONDS} seconds.` });
    }
    const media = {
      url: result.secure_url,
      type: isVideo ? "video" : "image",
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      durationSeconds: result.duration ? Math.round(result.duration) : undefined,
    };
    res.status(201).json({ media });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const createPost = async (req, res) => {
  try {
    const author = await User.findById(req.user._id).select("_id isPrivate name avatarUrl");
    if (!author) return res.status(404).json({ message: "User not found" });

    const caption = typeof req.body.caption === "string" ? req.body.caption.trim().slice(0, 500) : "";
    const incomingMedia = Array.isArray(req.body.media) ? req.body.media : [];
    const media = incomingMedia
      .slice(0, MAX_MEDIA_PER_POST)
      .map((item) => ({
        url: item?.url,
        type: item?.type === "video" ? "video" : "image",
        publicId: item?.publicId,
        width: item?.width,
        height: item?.height,
        durationSeconds: item?.durationSeconds,
      }))
      .filter((item) => item.url);

    if (!caption && media.length === 0) {
      return res.status(400).json({ message: "Post must include text or media" });
    }

    const videoCount = media.filter((m) => m.type === "video").length;
    if (videoCount > 1) return res.status(400).json({ message: "Only one video allowed per post" });
    const video = media.find((m) => m.type === "video");
    if (video && video.durationSeconds && video.durationSeconds > MAX_VIDEO_SECONDS) {
      return res.status(400).json({ message: `Videos must be under ${MAX_VIDEO_SECONDS} seconds.` });
    }

    const post = await Post.create({
      author: author._id,
      caption,
      media,
      visibility: author.isPrivate ? "private" : "public",
    });

    const populated = await post.populate("author", "_id name avatarUrl isPrivate");
    res.status(201).json({ post: serializePost(populated, req.user._id) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listFeedPosts = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const before = req.query.before ? new Date(req.query.before) : null;
    
    // Feed consists of posts from people I follow + my own posts
    const followingIds = await getFollowingIds(req.user._id);
    const authors = Array.from(followingIds);
    authors.push(req.user._id);

    const query = Post.find({
      author: { $in: authors },
      isDelete: { $ne: true },
      isDeleted: { $ne: true },
    });
    
    if (before && !isNaN(before.getTime())) {
      query.where("createdAt").lt(before);
    }
    const posts = await query
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "_id name avatarUrl isPrivate");
    const serialized = posts.map((p) => serializePost(p, req.user._id));
    const nextCursor = posts.length === limit ? posts[posts.length - 1].createdAt.toISOString() : null;
    res.json({ posts: serialized, nextCursor });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listUserPosts = async (req, res) => {
  try {
    const { userId } = req.params;
    const target = await User.findById(userId).select("_id isPrivate");
    if (!target) return res.status(404).json({ message: "User not found" });
    
    // If target is private and not me, I must be following them to see posts
    if (String(userId) !== String(req.user._id) && target.isPrivate) {
      const followingIds = await getFollowingIds(req.user._id);
      if (!followingIds.has(String(target._id))) {
        return res.status(403).json({ message: "Posts are private" });
      }
    }
    
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const before = req.query.before ? new Date(req.query.before) : null;
    const query = Post.find({
      author: userId,
      isDelete: { $ne: true },
      isDeleted: { $ne: true },
    });
    if (before && !isNaN(before.getTime())) query.where("createdAt").lt(before);
    const posts = await query
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "_id name avatarUrl isPrivate");
    const serialized = posts.map((p) => serializePost(p, req.user._id));
    const nextCursor = posts.length === limit ? posts[posts.length - 1].createdAt.toISOString() : null;
    res.json({ posts: serialized, nextCursor });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const likePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);
    if (!post || post.isDelete || post.isDeleted) return res.status(404).json({ message: "Post not found" });
    if (!(await canViewPost(req.user._id, post))) return res.status(403).json({ message: "Not allowed" });
    const already = post.likes.some((id) => String(id) === String(req.user._id));
    if (!already) {
      post.likes.push(req.user._id);
      await post.save();
    }
    res.json({ likeCount: post.likes.length, liked: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const unlikePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);
    if (!post || post.isDelete || post.isDeleted) return res.status(404).json({ message: "Post not found" });
    if (!(await canViewPost(req.user._id, post))) return res.status(403).json({ message: "Not allowed" });
    const beforeLength = post.likes.length;
    post.likes = post.likes.filter((id) => String(id) !== String(req.user._id));
    if (post.likes.length !== beforeLength) await post.save();
    res.json({ likeCount: post.likes.length, liked: false });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });
    const authorId = post.author && post.author._id ? post.author._id : post.author;
    if (String(authorId) !== String(req.user._id)) return res.status(403).json({ message: "Not allowed" });
    await post.deleteOne();
    await Comment.deleteMany({ post: post._id }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const listPostComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId)
      .select("author visibility media caption createdAt hideLikeCount commentsDisabled")
      .populate("author", "_id name avatarUrl");
    if (!post || post.isDelete || post.isDeleted) {
      return res.json({
        comments: [],
        nextCursor: null,
        post: { _id: postId, unavailable: true, unavailableReason: 'deleted' },
      });
    }

    if (!(await canViewPost(req.user._id, post))) {
      return res.json({
        comments: [],
        nextCursor: null,
        post: { _id: postId, unavailable: true, unavailableReason: 'private' },
      });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const before = req.query.before ? new Date(req.query.before) : null;

    const query = Comment.find({ post: postId });
    if (before && !isNaN(before.getTime())) query.where("createdAt").lt(before);
    const comments = await query
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("author", "_id name avatarUrl")
      .populate({ path: "parent", select: "_id author", populate: { path: "author", select: "_id name avatarUrl" } })
      .exec();

    const serialized = comments.map(serializeComment);
    const nextCursor = comments.length === limit ? comments[comments.length - 1].createdAt.toISOString() : null;
    const previewMedia = Array.isArray(post.media) && post.media.length ? post.media[0] : null;
    const postPreview = {
      _id: post._id,
      authorId: post.author?._id || post.author,
      authorName: post.author?.name,
      authorAvatar: post.author?.avatarUrl,
      caption: post.caption,
      media: previewMedia,
      createdAt: post.createdAt,
      hideLikeCount: !!post.hideLikeCount,
      commentsDisabled: !!post.commentsDisabled,
    };
    res.json({ comments: serialized, nextCursor, post: postPreview });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const text = typeof req.body.text === "string" ? req.body.text.trim().slice(0, 500) : "";
    if (!text) return res.status(400).json({ message: "Comment cannot be empty" });
    const rawParentId = typeof req.body.parentId === "string" ? req.body.parentId.trim() : "";

    const post = await Post.findById(postId)
      .select("author visibility caption media createdAt commentsDisabled")
      .populate("author", "_id name avatarUrl");
    if (!post || post.isDelete || post.isDeleted) return res.status(404).json({ message: "Post not found" });
    if (!(await canViewPost(req.user._id, post))) return res.status(403).json({ message: "Not allowed" });

    const postAuthorId = post.author?._id || post.author;
    if (post.commentsDisabled && String(postAuthorId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Comments are disabled for this post" });
    }

    let parentId = null;
    if (rawParentId) {
      const parentComment = await Comment.findOne({ _id: rawParentId, post: post._id }).select("_id parent");
      if (!parentComment) return res.status(404).json({ message: "Parent comment not found" });
      parentId = parentComment.parent ? parentComment.parent : parentComment._id;
    }

    const comment = await Comment.create({
      post: post._id,
      author: req.user._id,
      text,
      parent: parentId,
    });

    await Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } }).catch(() => {});
    await comment.populate([
      { path: "author", select: "_id name avatarUrl" },
      { path: "parent", select: "_id author", populate: { path: "author", select: "_id name avatarUrl" } },
    ]);

    const mentionMatches = Array.from(new Set((text.match(/@([\w]+)/g) || []).map((token) => token.slice(1).toLowerCase())));
    if (mentionMatches.length) {
      const mentionedUsers = await User.find({ nameLower: { $in: mentionMatches } }).select("_id");
      const eligibleMentionedIds = (await Promise.all(
        mentionedUsers.map(async (mentioned) => {
          if (String(mentioned._id) === String(req.user._id)) return null;
          const allowed = await canViewPost(mentioned._id, post);
          return allowed ? mentioned._id : null;
        })
      )).filter(Boolean);
      if (eligibleMentionedIds.length) {
        const previewMedia = Array.isArray(post.media) && post.media.length ? post.media[0] : null;
        const baseMetadata = {
          commentId: comment._id,
          postId: post._id,
          postOwnerId: post.author?._id || post.author,
          snippet: text.slice(0, 140),
          postPreview: {
            authorId: post.author?._id || post.author,
            authorName: post.author?.name,
            authorAvatar: post.author?.avatarUrl,
            caption: post.caption,
            media: previewMedia,
            createdAt: post.createdAt,
          },
        };
        await Promise.all(
          eligibleMentionedIds.map((mentionedId) =>
            Notification.findOneAndUpdate(
              { user: mentionedId, type: 'comment_mention', 'metadata.commentId': comment._id },
              {
                user: mentionedId,
                actor: req.user._id,
                type: 'comment_mention',
                metadata: { ...baseMetadata, mentionedUserId: mentionedId },
              },
              { upsert: true, setDefaultsOnInsert: true }
            ).catch(() => {})
          )
        );

        // Push mentions (only when recipient is offline)
        try {
          const onlineUsers = getOnlineUsers();
          const senderAvatarUrl = (req.user?.avatarUrl && (String(req.user.avatarUrl).startsWith('http') ? req.user.avatarUrl : null)) || null;

          await Promise.all(
            eligibleMentionedIds.map(async (mentionedId) => {
              const recipientId = String(mentionedId);
              const socketIds = getSocketIdsForUser(recipientId);
              const isOnline = socketIds.length > 0 || onlineUsers.has(recipientId);
              if (isOnline) return;
              const recipient = await User.findById(recipientId).select('pushToken');
              if (!recipient?.pushToken) return;
              await sendPushNotification(
                recipient.pushToken,
                'Mention',
                `${req.user.name || 'Someone'} mentioned you`,
                {
                  type: 'comment_mention',
                  postId: String(post._id),
                  commentId: String(comment._id),
                  senderId: String(req.user._id),
                  senderUsername: req.user.nickname || req.user.name || '',
                  senderAvatarUrl,
                },
                {
                  collapseId: `mention:${String(post._id)}:${recipientId}`,
                  threadId: `mention:${recipientId}`,
                  image: senderAvatarUrl,
                }
              );
            })
          );
        } catch {}
      }
    }

    const populated = comment;
    res.status(201).json({ comment: serializeComment(populated) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

export const updatePostSettings = async (req, res) => {
  try {
    const { postId } = req.params;
    const post = await Post.findById(postId).select("_id author hideLikeCount commentsDisabled");
    if (!post || post.isDelete || post.isDeleted) return res.status(404).json({ message: "Post not found" });
    const authorId = post.author && post.author._id ? post.author._id : post.author;
    if (String(authorId) !== String(req.user._id)) return res.status(403).json({ message: "Not allowed" });

    if (typeof req.body.hideLikeCount === "boolean") post.hideLikeCount = req.body.hideLikeCount;
    if (typeof req.body.commentsDisabled === "boolean") post.commentsDisabled = req.body.commentsDisabled;
    await post.save();

    return res.json({
      ok: true,
      hideLikeCount: !!post.hideLikeCount,
      commentsDisabled: !!post.commentsDisabled,
    });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

export const deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const comment = await Comment.findOne({ _id: commentId, post: postId }).populate("author", "_id");
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const post = await Post.findById(postId).select("author isDelete isDeleted");
    if (!post || post.isDelete || post.isDeleted) return res.status(404).json({ message: "Post not found" });

    const isCommentAuthor = comment.author && String(comment.author._id || comment.author) === String(req.user._id);
    const postAuthorId = post.author && post.author._id ? post.author._id : post.author;
    const isPostOwner = String(postAuthorId) === String(req.user._id);
    if (!isCommentAuthor && !isPostOwner) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const replyResult = await Comment.deleteMany({ parent: comment._id });
    await comment.deleteOne();
    await Post.updateOne(
      { _id: post._id },
      { $inc: { commentCount: -(1 + (replyResult.deletedCount || 0)) } }
    ).catch(() => {});
    res.json({ ok: true, removedReplies: replyResult.deletedCount || 0 });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};
