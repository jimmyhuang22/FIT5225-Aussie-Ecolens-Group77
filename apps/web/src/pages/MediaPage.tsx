import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  bulkDeleteMedia,
  bulkUpdateTags,
  completeUpload,
  createSubscription,
  createUploadUrl,
  deleteMedia,
  deleteSubscription,
  listMedia,
  listSubscriptions,
  lookupOriginalByThumbnail,
  queryMediaByFile,
  queryMediaByTags,
  sha256Hex,
  uploadToPresignedUrl,
  type MediaItem,
  type Subscription,
} from "../api";
import { useAuth } from "../auth/AuthContext";

type Notice = { tone: "info" | "error" | "success"; text: string } | null;
type ThumbnailLookupResult = {
  mediaId: string;
  originalUrl: string | null;
  storageObject: string;
};

const PENDING_MEDIA_STATUSES = new Set(["upload_url_issued", "uploaded", "processing"]);

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message === "thumbnail_lookup_failed_400") {
      return "No matching image found in this account. Check the thumbnail URL and signed-in account.";
    }
    if (err.detail) return `${err.detail} (${err.status})`;
    return `${err.message} (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function formatTags(item: MediaItem): string {
  const entries = Object.entries(item.tagCounts || {});
  if (entries.length === 0) return "No tags yet";
  return entries.map(([tag, count]) => `${tag} x${count}`).join(", ");
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseTagCounts(value: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [rawTag, rawCount] = trimmed.split(":", 2);
    const tag = rawTag.trim();
    const count = rawCount === undefined ? 1 : Number.parseInt(rawCount.trim(), 10);
    if (!tag || !Number.isFinite(count) || count < 1) {
      throw new Error("Use tag:count pairs, for example dingo:2, cattle:1");
    }
    out[tag] = count;
  }
  if (Object.keys(out).length === 0) {
    throw new Error("At least one tag is required.");
  }
  return out;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}...${id.slice(-6)}` : id;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export function MediaPage() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [tag, setTag] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [subscriptionEmail, setSubscriptionEmail] = useState("");
  const [subscriptionTags, setSubscriptionTags] = useState("");
  const [tagCountQuery, setTagCountQuery] = useState("");
  const [queryFile, setQueryFile] = useState<File | null>(null);
  const [thumbnailLookupUrl, setThumbnailLookupUrl] = useState("");
  const [thumbnailLookupResult, setThumbnailLookupResult] =
    useState<ThumbnailLookupResult | null>(null);
  const [bulkTags, setBulkTags] = useState("");
  const [bulkOperation, setBulkOperation] = useState<"1" | "0">("1");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const processedCount = useMemo(
    () => items.filter((item) => item.status === "processed").length,
    [items],
  );
  const tagCount = useMemo(
    () => new Set(items.flatMap((item) => item.tags || [])).size,
    [items],
  );
  const hasPendingMedia = useMemo(
    () => items.some((item) => PENDING_MEDIA_STATUSES.has(item.status)),
    [items],
  );

  async function refresh(nextTag = tag, options: { showLoading?: boolean } = {}) {
    const showLoading = options.showLoading ?? true;
    if (showLoading) setLoading(true);
    try {
      const [mediaResult, subscriptionResult] = await Promise.all([
        listMedia(nextTag.trim() || undefined),
        listSubscriptions(),
      ]);
      setItems(mediaResult.items);
      setSelectedIds((previous) =>
        previous.filter((id) => mediaResult.items.some((item) => item.mediaId === id)),
      );
      setSubscriptions(subscriptionResult.items.filter((item) => item.active));
    } catch (err) {
      setNotice({ tone: "error", text: `Refresh failed: ${errorMessage(err)}` });
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasPendingMedia) return undefined;
    const intervalId = window.setInterval(() => {
      void refresh(tag, { showLoading: false });
    }, 5000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPendingMedia, tag]);

  async function onUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    setNotice({ tone: "info", text: "Calculating file checksum..." });
    try {
      const checksum = await sha256Hex(file);
      setNotice({ tone: "info", text: "Creating upload URL..." });
      const upload = await createUploadUrl(file, checksum);
      if (upload.duplicate) {
        setFile(null);
        setNotice({
          tone: "success",
          text: "Duplicate detected. Existing media record was reused.",
        });
        await refresh();
        return;
      }
      if (!upload.uploadUrl) {
        throw new Error("Upload URL was not returned.");
      }
      setNotice({ tone: "info", text: "Uploading to S3..." });
      await uploadToPresignedUrl(upload.uploadUrl, file, upload.uploadHeaders);
      setNotice({ tone: "info", text: "Finalising upload..." });
      await completeUpload(upload.mediaId);
      setFile(null);
      setNotice({
        tone: "success",
        text: "Upload complete. Processing may take a few seconds.",
      });
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: `Upload failed: ${errorMessage(err)}` });
    } finally {
      setUploading(false);
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    await refresh();
  }

  async function onTagCountSearch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const query = parseTagCounts(tagCountQuery);
      const [mediaResult, subscriptionResult] = await Promise.all([
        queryMediaByTags(query),
        listSubscriptions(),
      ]);
      setItems(mediaResult.items);
      setSelectedIds([]);
      setSubscriptions(subscriptionResult.items.filter((item) => item.active));
      setNotice({ tone: "success", text: "Tag-count query complete." });
    } catch (err) {
      setNotice({ tone: "error", text: `Tag-count query failed: ${errorMessage(err)}` });
    } finally {
      setLoading(false);
    }
  }

  async function onQueryFile(event: FormEvent) {
    event.preventDefault();
    if (!queryFile) return;
    setLoading(true);
    setNotice({ tone: "info", text: "Running query file inference..." });
    try {
      const [mediaResult, subscriptionResult] = await Promise.all([
        queryMediaByFile(queryFile),
        listSubscriptions(),
      ]);
      setItems(mediaResult.items);
      setSelectedIds([]);
      setSubscriptions(subscriptionResult.items.filter((item) => item.active));
      const inferred = Object.keys(mediaResult.inferredTagCounts || {}).join(", ");
      setNotice({
        tone: "success",
        text: inferred
          ? `Query image analyzed: ${inferred}`
          : "No tags detected in query image.",
      });
    } catch (err) {
      setNotice({ tone: "error", text: `Query file failed: ${errorMessage(err)}` });
    } finally {
      setLoading(false);
    }
  }

  async function onThumbnailUrlLookup(event: FormEvent) {
    event.preventDefault();
    const value = thumbnailLookupUrl.trim();
    if (!value) {
      setNotice({ tone: "error", text: "Thumbnail URL is required." });
      return;
    }
    setLoading(true);
    setThumbnailLookupResult(null);
    setNotice({ tone: "info", text: "Resolving thumbnail..." });
    try {
      const result = await lookupOriginalByThumbnail(value);
      setThumbnailLookupResult({
        mediaId: result.mediaId,
        originalUrl: result.originalUrl,
        storageObject: result.storageObject,
      });
      setNotice({ tone: "success", text: "Thumbnail resolved in this account." });
    } catch (err) {
      setNotice({ tone: "error", text: `Thumbnail lookup failed: ${errorMessage(err)}` });
    } finally {
      setLoading(false);
    }
  }

  async function onBulkUpdate(event: FormEvent) {
    event.preventDefault();
    const tags = splitTags(bulkTags);
    if (selectedIds.length === 0) {
      setNotice({ tone: "error", text: "Select at least one media item." });
      return;
    }
    if (tags.length === 0) {
      setNotice({ tone: "error", text: "Enter at least one tag." });
      return;
    }
    setNotice({ tone: "info", text: "Updating tags..." });
    try {
      const updated = await bulkUpdateTags(
        selectedIds,
        tags,
        bulkOperation === "1" ? 1 : 0,
      );
      const updatedById = new Map(updated.map((item) => [item.mediaId, item]));
      setItems((previous) =>
        previous.map((item) => updatedById.get(item.mediaId) ?? item),
      );
      setNotice({ tone: "success", text: "Tags updated." });
    } catch (err) {
      setNotice({ tone: "error", text: `Tag update failed: ${errorMessage(err)}` });
    }
  }

  async function onBulkDelete() {
    const selectedItems = items.filter((item) => selectedIds.includes(item.mediaId));
    if (selectedItems.length === 0) {
      setNotice({ tone: "error", text: "Select at least one media item." });
      return;
    }
    const urls = selectedItems
      .map((item) => item.originalUrl || item.thumbnailUrl || item.storageObject)
      .filter((url): url is string => Boolean(url));
    if (urls.length === 0) {
      setNotice({ tone: "error", text: "Select at least one media item with a URL." });
      return;
    }
    const confirmed = window.confirm(
      `Delete ${selectedItems.length} selected ${pluralize(
        selectedItems.length,
        "media item",
      )}? This permanently removes the media and thumbnail files.`,
    );
    if (!confirmed) return;
    setNotice({ tone: "info", text: "Deleting selected media..." });
    try {
      const result = await bulkDeleteMedia(urls);
      setNotice({ tone: "success", text: `${result.count} media item(s) deleted.` });
      setSelectedIds([]);
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: `Bulk delete failed: ${errorMessage(err)}` });
    }
  }

  function toggleSelected(mediaId: string) {
    setSelectedIds((previous) =>
      previous.includes(mediaId)
        ? previous.filter((id) => id !== mediaId)
        : [...previous, mediaId],
    );
  }

  async function onDelete(mediaId: string) {
    const confirmed = window.confirm(
      `Delete ${shortId(mediaId)}? This permanently removes the media and thumbnail files.`,
    );
    if (!confirmed) return;
    setNotice({ tone: "info", text: "Deleting media..." });
    try {
      await deleteMedia(mediaId);
      setNotice({ tone: "success", text: "Media deleted." });
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: `Delete failed: ${errorMessage(err)}` });
    }
  }

  async function onThumbnailLookup(item: MediaItem) {
    if (!item.thumbnailUrl) return;
    setNotice({ tone: "info", text: "Resolving thumbnail..." });
    try {
      const result = await lookupOriginalByThumbnail(item.thumbnailUrl);
      if (result.originalUrl) {
        window.open(result.originalUrl, "_blank", "noopener,noreferrer");
        setNotice({ tone: "success", text: "Original image URL resolved." });
      } else {
        setNotice({ tone: "error", text: "Original image URL was not returned." });
      }
    } catch (err) {
      setNotice({ tone: "error", text: `Thumbnail lookup failed: ${errorMessage(err)}` });
    }
  }

  async function onCopyUrl(label: string, url: string | null) {
    if (!url) {
      setNotice({ tone: "error", text: `${label} URL is not available.` });
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "success", text: `${label} URL copied.` });
    } catch (err) {
      setNotice({ tone: "error", text: `Copy failed: ${errorMessage(err)}` });
    }
  }

  async function onCreateSubscription(event: FormEvent) {
    event.preventDefault();
    const tags = splitTags(subscriptionTags);
    if (!subscriptionEmail.trim() || tags.length === 0) {
      setNotice({ tone: "error", text: "Email and at least one tag are required." });
      return;
    }
    setNotice({ tone: "info", text: "Creating subscription..." });
    try {
      await createSubscription(subscriptionEmail.trim(), tags);
      setSubscriptionTags("");
      setNotice({
        tone: "success",
        text: "Subscription saved. Confirm the SNS email if this is a new address.",
      });
      await refresh();
    } catch (err) {
      setNotice({
        tone: "error",
        text: `Subscription failed: ${errorMessage(err)}`,
      });
    }
  }

  async function onDeleteSubscription(subscriptionId: string) {
    setNotice({ tone: "info", text: "Removing subscription..." });
    try {
      await deleteSubscription(subscriptionId);
      setNotice({ tone: "success", text: "Subscription removed." });
      await refresh();
    } catch (err) {
      setNotice({
        tone: "error",
        text: `Remove failed: ${errorMessage(err)}`,
      });
    }
  }

  return (
    <section className="workspace-page">
      <div className="workspace-header">
        <div>
          <h1>Media workspace</h1>
          <p>{user?.username ?? "Signed in user"}</p>
        </div>
        <button type="button" className="secondary action-button" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <span>Total media</span>
          <strong>{items.length}</strong>
        </div>
        <div className="metric">
          <span>Processed</span>
          <strong>{processedCount}</strong>
        </div>
        <div className="metric">
          <span>Unique tags</span>
          <strong>{tagCount}</strong>
        </div>
        <div className="metric">
          <span>Subscriptions</span>
          <strong>{subscriptions.length}</strong>
        </div>
      </div>

      {notice && <div className={`notice ${notice.tone}`}>{notice.text}</div>}

      <div className="workspace-grid">
        <section className="panel">
          <h2>Upload</h2>
          <form className="form" onSubmit={onUpload}>
            <label>
              Image or video
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {file && (
              <div className="file-summary">
                <strong>{file.name}</strong>
                <span>{Math.max(file.size / 1024 / 1024, 0.01).toFixed(2)} MB</span>
              </div>
            )}
            <button type="submit" disabled={!file || uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Search</h2>
          <form className="form" onSubmit={onSearch}>
            <label>
              Tag
              <input
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                placeholder="alectura_lathami"
              />
            </label>
            <button type="submit">Search</button>
          </form>
        </section>

        <section className="panel">
          <h2>Tag counts</h2>
          <form className="form" onSubmit={onTagCountSearch}>
            <label>
              Query
              <input
                value={tagCountQuery}
                onChange={(event) => setTagCountQuery(event.target.value)}
                placeholder="dingo:2, cattle:1"
              />
            </label>
            <button type="submit">Query</button>
          </form>
        </section>

        <section className="panel">
          <h2>Query image</h2>
          <form className="form" onSubmit={onQueryFile}>
            <label>
              Image file
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setQueryFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button type="submit" disabled={!queryFile || loading}>
              Match
            </button>
          </form>
        </section>

        <section className="panel">
          <h2>Thumbnail lookup</h2>
          <form className="form" onSubmit={onThumbnailUrlLookup}>
            <label>
              Thumbnail URL
              <input
                value={thumbnailLookupUrl}
                onChange={(event) => setThumbnailLookupUrl(event.target.value)}
                placeholder="https://..."
                type="url"
              />
            </label>
            <button type="submit" disabled={loading}>
              Find original
            </button>
            {thumbnailLookupResult && (
              <div className="file-summary">
                <strong>{shortId(thumbnailLookupResult.mediaId)}</strong>
                {thumbnailLookupResult.originalUrl ? (
                  <a href={thumbnailLookupResult.originalUrl} target="_blank" rel="noreferrer">
                    Original
                  </a>
                ) : (
                  <span>{thumbnailLookupResult.storageObject}</span>
                )}
              </div>
            )}
          </form>
        </section>

        <section className="panel">
          <h2>Bulk tags</h2>
          <form className="form" onSubmit={onBulkUpdate}>
            <label>
              Tags
              <input
                value={bulkTags}
                onChange={(event) => setBulkTags(event.target.value)}
                placeholder="reviewed, demo"
              />
            </label>
            <label>
              Operation
              <select
                value={bulkOperation}
                onChange={(event) => setBulkOperation(event.target.value as "1" | "0")}
              >
                <option value="1">Add</option>
                <option value="0">Remove</option>
              </select>
            </label>
            <button type="submit">Apply tag change</button>
            <div className="destructive-actions">
              <button
                type="button"
                className="danger"
                disabled={selectedIds.length === 0}
                onClick={() => void onBulkDelete()}
              >
                {selectedIds.length > 0
                  ? `Delete ${selectedIds.length} selected ${pluralize(
                      selectedIds.length,
                      "media item",
                    )}`
                  : "Delete selected media"}
              </button>
            </div>
          </form>
        </section>

        <section className="panel subscriptions-panel">
          <h2>Notifications</h2>
          <form className="form" onSubmit={onCreateSubscription}>
            <label>
              Email
              <input
                value={subscriptionEmail}
                onChange={(event) => setSubscriptionEmail(event.target.value)}
                placeholder="name@example.com"
                type="email"
              />
            </label>
            <label>
              Tags
              <input
                value={subscriptionTags}
                onChange={(event) => setSubscriptionTags(event.target.value)}
                placeholder="alectura_lathami, felis_catus"
              />
            </label>
            <button type="submit">Subscribe</button>
          </form>
          <div className="subscription-list">
            {subscriptions.map((subscription) => (
              <div className="subscription-row" key={subscription.subscriptionId}>
                <div>
                  <strong>{subscription.email}</strong>
                  <span>{subscription.tags.join(", ")}</span>
                  {subscription.snsStatus && <span>SNS: {subscription.snsStatus}</span>}
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void onDeleteSubscription(subscription.subscriptionId)}
                >
                  Remove
                </button>
              </div>
            ))}
            {subscriptions.length === 0 && (
              <div className="empty-state">No active subscriptions.</div>
            )}
          </div>
        </section>
      </div>

      <section className="panel media-results">
        <div className="panel-heading">
          <h2>Results</h2>
          {loading && <span>Loading...</span>}
        </div>
        <div className="media-list">
          {items.map((item) => (
            <article className="media-row" key={item.mediaId}>
              <div className="media-main">
                <label className="media-select" aria-label={`Select ${item.mediaId}`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.mediaId)}
                    onChange={() => toggleSelected(item.mediaId)}
                  />
                </label>
                <div className="media-preview">
                  {item.thumbnailUrl || (item.originalUrl && item.mediaType === "image") ? (
                    <img src={item.thumbnailUrl || item.originalUrl || ""} alt={item.mediaId} />
                  ) : (
                    <span>{item.mediaType}</span>
                  )}
                </div>
                <div>
                  <div className="media-title">
                    <strong>{shortId(item.mediaId)}</strong>
                    <span className={`status-pill ${item.status}`}>{item.status}</span>
                  </div>
                  <p>{item.storageObject}</p>
                  <p>{formatTags(item)}</p>
                  <p>{item.modelVersion}</p>
                  {item.status === "failed" && item.processingError && (
                    <p className="processing-error">Error: {item.processingError}</p>
                  )}
                </div>
              </div>
              <div className="media-actions">
                {item.originalUrl && (
                  <a href={item.originalUrl} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
                {item.thumbnailUrl && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void onCopyUrl("Thumbnail", item.thumbnailUrl)}
                  >
                    Copy thumbnail
                  </button>
                )}
                {item.originalUrl && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void onCopyUrl("Original", item.originalUrl)}
                  >
                    Copy original
                  </button>
                )}
                {item.mediaType === "image" && item.thumbnailUrl && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => void onThumbnailLookup(item)}
                  >
                    Lookup original
                  </button>
                )}
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => void onDelete(item.mediaId)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
          {items.length === 0 && <div className="empty-state">No media found.</div>}
        </div>
      </section>
    </section>
  );
}
