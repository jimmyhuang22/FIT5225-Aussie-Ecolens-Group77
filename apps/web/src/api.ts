import { fetchAuthSession } from "aws-amplify/auth";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;

  constructor(
    status: number,
    message: string,
    options: { code?: string; detail?: string } = {},
  ) {
    super(message);
    this.status = status;
    this.code = options.code;
    this.detail = options.detail;
    this.name = "ApiError";
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString();
  if (!idToken) {
    throw new ApiError(401, "no_id_token");
  }
  return { Authorization: `Bearer ${idToken}` };
}

export interface MeResponse {
  user: {
    sub: string;
    username: string | null;
    email: string | null;
    given_name: string | null;
    family_name: string | null;
    token_use: string;
  };
}

export async function fetchMe(): Promise<MeResponse> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/api/me`, { headers });
  if (!res.ok) {
    throw new ApiError(res.status, `api_me_failed_${res.status}`);
  }
  return (await res.json()) as MeResponse;
}

export interface UploadUrlResponse {
  mediaId: string;
  duplicate: boolean;
  uploadUrl: string | null;
  uploadHeaders?: Record<string, string>;
  bucket: string | null;
  objectKey: string | null;
  expiresIn: number;
  media?: MediaItem;
}

export interface MediaItem {
  mediaId: string;
  mediaType: "image" | "video";
  storageObject: string;
  status: string;
  tags: string[];
  tagCounts: Record<string, number>;
  modelVersion: string;
  processingError?: string | null;
  originalUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaListResponse {
  items: MediaItem[];
}

export interface MediaQueryResponse {
  query: Record<string, number>;
  items: MediaItem[];
  inferredTagCounts?: Record<string, number>;
  modelVersion?: string | null;
}

export interface Subscription {
  subscriptionId: string;
  ownerSub: string;
  email: string;
  tags: string[];
  active: boolean;
  snsStatus?: string;
  snsSubscriptionArn?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionListResponse {
  items: Subscription[];
}

export async function createUploadUrl(
  file: File,
  checksumSha256: string,
): Promise<UploadUrlResponse> {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_BASE_URL}/media/upload-url`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      mediaType: file.type.startsWith("video/") ? "video" : "image",
      checksumSha256,
    }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `upload_url_failed_${res.status}`);
  }
  return (await res.json()) as UploadUrlResponse;
}

export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadToPresignedUrl(
  uploadUrl: string,
  file: File,
  uploadHeaders: Record<string, string> = {},
): Promise<void> {
  const headers = {
    "Content-Type": file.type || "application/octet-stream",
    ...uploadHeaders,
  };
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers,
    body: file,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `s3_upload_failed_${res.status}`);
  }
}

export async function completeUpload(mediaId: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/media/${mediaId}/complete`, {
    method: "POST",
    headers,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `complete_upload_failed_${res.status}`);
  }
}

export async function listMedia(tag?: string): Promise<MediaListResponse> {
  const headers = await authHeader();
  const query = tag ? `?tag=${encodeURIComponent(tag)}` : "";
  const res = await fetch(`${API_BASE_URL}/media${query}`, { headers });
  if (!res.ok) {
    throw new ApiError(res.status, `list_media_failed_${res.status}`);
  }
  return (await res.json()) as MediaListResponse;
}

export async function queryMediaByTags(
  tags: Record<string, number>,
): Promise<MediaQueryResponse> {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_BASE_URL}/media/query/tags`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `query_tags_failed_${res.status}`);
  }
  return (await res.json()) as MediaQueryResponse;
}

export async function queryMediaByFile(file: File): Promise<MediaQueryResponse> {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
  };
  const base64 = await fileToBase64(file);
  const res = await fetch(`${API_BASE_URL}/media/query/file`, {
    method: "POST",
    headers,
    body: JSON.stringify({ base64 }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `query_file_failed_${res.status}`);
  }
  return (await res.json()) as MediaQueryResponse;
}

export async function bulkUpdateTags(
  mediaIds: string[],
  tags: string[],
  operation: 0 | 1,
): Promise<MediaItem[]> {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_BASE_URL}/media/tags/bulk`, {
    method: "POST",
    headers,
    body: JSON.stringify({ mediaIds, tags, operation }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `bulk_tags_failed_${res.status}`);
  }
  const payload = (await res.json()) as { updated: MediaItem[] };
  return payload.updated;
}

export async function bulkDeleteMedia(
  urls: string[],
): Promise<{ deleted: Array<{ mediaId: string }>; count: number }> {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_BASE_URL}/media/delete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `bulk_delete_failed_${res.status}`);
  }
  return (await res.json()) as {
    deleted: Array<{ mediaId: string }>;
    count: number;
  };
}

export async function lookupOriginalByThumbnail(thumbnailUrl: string): Promise<{
  mediaId: string;
  thumbnailUrl: string | null;
  originalUrl: string | null;
  storageObject: string;
}> {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_BASE_URL}/media/query/thumbnail`, {
    method: "POST",
    headers,
    body: JSON.stringify({ thumbnailUrl }),
  });
  if (!res.ok) {
    let errorPayload: { error?: string; message?: string } = {};
    try {
      errorPayload = (await res.json()) as { error?: string; message?: string };
    } catch {
      errorPayload = {};
    }
    throw new ApiError(res.status, `thumbnail_lookup_failed_${res.status}`, {
      code: errorPayload.error,
      detail: errorPayload.message,
    });
  }
  return (await res.json()) as {
    mediaId: string;
    thumbnailUrl: string | null;
    originalUrl: string | null;
    storageObject: string;
  };
}

export async function deleteMedia(mediaId: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/media/${mediaId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `delete_media_failed_${res.status}`);
  }
}

export async function listSubscriptions(): Promise<SubscriptionListResponse> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/subscriptions`, { headers });
  if (!res.ok) {
    throw new ApiError(res.status, `list_subscriptions_failed_${res.status}`);
  }
  return (await res.json()) as SubscriptionListResponse;
}

export async function createSubscription(
  email: string,
  tags: string[],
): Promise<Subscription> {
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
  };
  const res = await fetch(`${API_BASE_URL}/subscriptions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, tags }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, `create_subscription_failed_${res.status}`);
  }
  const payload = (await res.json()) as { subscription: Subscription };
  return payload.subscription;
}

export async function deleteSubscription(subscriptionId: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${API_BASE_URL}/subscriptions/${subscriptionId}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `delete_subscription_failed_${res.status}`);
  }
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
  return dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
}
