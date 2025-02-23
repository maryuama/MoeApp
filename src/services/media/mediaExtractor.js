// mediaExtractor.js
import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";
import {
  extractInstagramMedia,
  extractTikTokMedia,
  extractFacebookMedia,
} from "./extractors.js";

const { MessageMedia } = WhatsAppWeb;
const PROCESSING_TIMEOUT = 60000; // 60 seconds

// Configure axios instance
const axiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 10,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept: "image/*, video/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  },
  validateStatus: (status) => status >= 200 && status < 300,
  maxContentLength: 50 * 1024 * 1024, // 50MB max
  maxBodyLength: 50 * 1024 * 1024, // 50MB max
});

// Extract URLs from message
function extractUrl(messageBody) {
  if (!messageBody) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    const match = messageBody.match(pattern);
    if (match && match[0]) return match[0];
  }
  return null;
}

// Determine media type from URL
function getMediaType(url) {
  if (!url) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    if (pattern.test(url)) return platform.toLowerCase();
  }
  return null;
}

// Download media
async function downloadMedia(url) {
  if (!url) throw new Error("Invalid media URL");

  const response = await axiosInstance.get(url, {
    responseType: "arraybuffer",
    timeout: PROCESSING_TIMEOUT,
  });

  const buffer = Buffer.from(response.data);
  const base64 = buffer.toString("base64");
  const mimeType =
    response.headers["content-type"] || "application/octet-stream";

  return { base64, mimeType };
}

// Extract media URL based on platform
async function extractMediaUrl(url, mediaType) {
  if (!url || !mediaType) {
    throw new Error("Invalid URL or media type");
  }

  const extractors = {
    instagram: extractInstagramMedia,
    tiktok: extractTikTokMedia,
    facebook: extractFacebookMedia,
  };

  const extractor = extractors[mediaType];
  if (!extractor) {
    throw new Error(`No extractor available for media type: ${mediaType}`);
  }

  try {
    const extractPromise = extractor(url);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Media extraction timed out")),
        PROCESSING_TIMEOUT,
      ),
    );

    return await Promise.race([extractPromise, timeoutPromise]);
  } catch (error) {
    logger.error("Media extraction failed");
    throw error;
  }
}

// Send media to chat
async function sendMedia(url, message) {
  if (!url || !message) return false;

  try {
    const mediaType = getMediaType(url);
    if (!mediaType) return false;

    logger.info(`Processing ${mediaType} URL`);
    let mediaUrls = await extractMediaUrl(url, mediaType);

    if (!Array.isArray(mediaUrls)) {
      mediaUrls = [mediaUrls];
    }

    for (const mediaUrl of mediaUrls) {
      const { base64, mimeType } = await downloadMedia(mediaUrl);
      const media = new MessageMedia(mimeType, base64);

      await message.reply(media);
    }

    return true;
  } catch (error) {
    logger.error("Error in extracting URL");
    return false;
  }
}

// Main handler for media extraction
export async function handleMediaExtraction(message) {
  if (!message?.body) return { processed: false };

  try {
    const url = extractUrl(message.body);
    if (!url) return { processed: false };

    const mediaType = getMediaType(url);
    if (!mediaType) return { processed: false };

    const chat = await message.getChat();
    await chat.sendStateTyping();

    const success = await sendMedia(url, message);

    return {
      processed: success,
      mediaType,
      url,
    };
  } catch (error) {
    logger.error("Error in handling media");
    return { processed: false, error: error.message };
  }
}
