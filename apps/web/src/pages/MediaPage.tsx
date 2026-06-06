import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Copy,
  ExternalLink,
  FileImage,
  ImageUp,
  Loader2,
  RefreshCcw,
  Search,
  ShieldAlert,
  Tags,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  updateMediaSharing,
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
type DeleteTarget =
  | { kind: "single"; mediaId: string }
  | { kind: "bulk" }
  | { kind: "subscription"; subscriptionId: string }
  | null;
type ToolTab = "upload" | "search" | "manage" | "notify";
type SharingMode = "private" | "shared" | "shared_edit";
type MediaScope = "all" | "mine" | "shared";

const PENDING_MEDIA_STATUSES = new Set(["upload_url_issued", "uploaded", "processing"]);
const MEDIA_SCOPE_OPTIONS: { value: MediaScope; label: string }[] = [
  { value: "all", label: "All visible" },
  { value: "mine", label: "Mine" },
  { value: "shared", label: "Shared with me" },
];

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.message === "thumbnail_lookup_failed_400") {
      return "No matching accessible image found. Check the thumbnail URL and signed-in account.";
    }
    if (err.detail) return `${err.detail} (${err.status})`;
    return `${err.message} (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
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
  if (Object.keys(out).length === 0) throw new Error("At least one tag is required.");
  return out;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}...${id.slice(-6)}` : id;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function fileCount(count: number): string {
  return `${count} ${pluralize(count, "file")}`;
}

function mediaHasTag(item: MediaItem, tag: string): boolean {
  const normalized = normalizeTag(tag);
  if (Number(item.tagCounts?.[normalized] ?? 0) > 0) return true;
  return (item.tags || []).some((itemTag) => normalizeTag(itemTag) === normalized);
}

function bulkTagToastDescription(items: MediaItem[], tags: string[], operation: "1" | "0"): string {
  if (operation === "1") {
    return `Updated ${fileCount(items.length)}. Added tags are set to at least x1.`;
  }

  const normalizedTags = [...new Set(tags.map(normalizeTag).filter(Boolean))];
  const summaries = normalizedTags.map((tag) => {
    const removedCount = items.filter((item) => mediaHasTag(item, tag)).length;
    const ignoredCount = Math.max(items.length - removedCount, 0);
    if (removedCount > 0 && ignoredCount > 0) {
      return `Removed ${tag} from ${fileCount(removedCount)}; ignored on ${fileCount(ignoredCount)}.`;
    }
    if (removedCount > 0) {
      return `Removed ${tag} from ${fileCount(removedCount)}.`;
    }
    return `Ignored ${tag} because it was not assigned to ${fileCount(ignoredCount)}.`;
  });

  return `Updated ${fileCount(items.length)}. ${summaries.join(" ")}`;
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "secondary" {
  if (status === "processed") return "success";
  if (status === "failed") return "destructive";
  if (PENDING_MEDIA_STATUSES.has(status)) return "warning";
  return "secondary";
}

function subscriptionStatusLabel(status?: string): string {
  if (status === "subscribed") return "Confirmed";
  if (status === "pending_confirmation") return "Pending confirmation";
  return status ? status.replace(/_/g, " ") : "Status unknown";
}

function subscriptionStatusVariant(status?: string): "success" | "warning" | "secondary" {
  if (status === "subscribed") return "success";
  if (status === "pending_confirmation") return "warning";
  return "secondary";
}

function mediaVisibility(item: MediaItem): "private" | "shared" {
  return item.visibility === "shared" ? "shared" : "private";
}

function isMediaOwner(item: MediaItem, userId?: string): boolean {
  return Boolean(userId && item.ownerSub === userId);
}

function canEditMediaTags(item: MediaItem, userId?: string): boolean {
  return isMediaOwner(item, userId) || (mediaVisibility(item) === "shared" && item.allowTagEdit);
}

function canDeleteMedia(item: MediaItem, userId?: string): boolean {
  return isMediaOwner(item, userId);
}

function toneToAlert(tone: NonNullable<Notice>["tone"]): "default" | "destructive" | "success" | "info" {
  if (tone === "error") return "destructive";
  if (tone === "success") return "success";
  return "info";
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="summary-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <Label className="block text-[0.95rem] font-semibold text-emerald-950">{label}</Label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | boolean | null | undefined }) {
  const displayValue = typeof value === "boolean" ? (value ? "Yes" : "No") : value || "Not available";
  const urlValue = typeof value === "string" && /^https?:\/\//.test(value) ? value : "";
  return (
    <div className="grid gap-1 rounded-md border bg-muted/30 p-3 sm:grid-cols-[8rem_1fr]">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm text-foreground">
        {urlValue ? (
          <a href={urlValue} target="_blank" rel="noreferrer">
            {urlValue}
          </a>
        ) : (
          displayValue
        )}
      </dd>
    </div>
  );
}

function sharingMode(item: MediaItem): SharingMode {
  if (mediaVisibility(item) !== "shared") return "private";
  return item.allowTagEdit ? "shared_edit" : "shared";
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
  const [activeTool, setActiveTool] = useState<ToolTab>("upload");
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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [mediaScope, setMediaScope] = useState<MediaScope>("all");

  const processedCount = useMemo(
    () => items.filter((item) => item.status === "processed").length,
    [items],
  );
  const tagCount = useMemo(() => new Set(items.flatMap((item) => item.tags || [])).size, [items]);
  const hasPendingMedia = useMemo(
    () => items.some((item) => PENDING_MEDIA_STATUSES.has(item.status)),
    [items],
  );
  const mineCount = useMemo(
    () => (user?.userId ? items.filter((item) => isMediaOwner(item, user.userId)).length : 0),
    [items, user?.userId],
  );
  const sharedWithMeCount = useMemo(
    () =>
      user?.userId
        ? items.filter((item) => !isMediaOwner(item, user.userId) && mediaVisibility(item) === "shared").length
        : 0,
    [items, user?.userId],
  );
  const visibleItems = useMemo(() => {
    if (mediaScope === "mine") {
      return user?.userId ? items.filter((item) => isMediaOwner(item, user.userId)) : [];
    }
    if (mediaScope === "shared") {
      return user?.userId
        ? items.filter((item) => !isMediaOwner(item, user.userId) && mediaVisibility(item) === "shared")
        : [];
    }
    return items;
  }, [items, mediaScope, user?.userId]);
  const mediaScopeCounts: Record<MediaScope, number> = {
    all: items.length,
    mine: mineCount,
    shared: sharedWithMeCount,
  };
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedIds.includes(item.mediaId)),
    [visibleItems, selectedIds],
  );
  const selectedCanEditTags = useMemo(
    () => selectedItems.length > 0 && selectedItems.every((item) => canEditMediaTags(item, user?.userId)),
    [selectedItems, user?.userId],
  );
  const selectedCanDelete = useMemo(
    () => selectedItems.length > 0 && selectedItems.every((item) => canDeleteMedia(item, user?.userId)),
    [selectedItems, user?.userId],
  );
  const signedInLabel = user?.email || user?.username || (user?.userId ? shortId(user.userId) : "Cognito user");

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
      if (showLoading) setNotice(null);
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Refresh failed: ${message}` });
      toast.error("Refresh failed", { description: message });
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
        setNotice(null);
        toast.success("Duplicate detected", { description: "Existing media record was reused." });
        await refresh();
        return;
      }
      if (!upload.uploadUrl) throw new Error("Upload URL was not returned.");
      setNotice({ tone: "info", text: "Uploading to S3..." });
      await uploadToPresignedUrl(upload.uploadUrl, file, upload.uploadHeaders);
      setNotice({ tone: "info", text: "Finalising upload..." });
      await completeUpload(upload.mediaId);
      setFile(null);
      setNotice(null);
      toast.success("Upload complete", { description: "Processing may take a few seconds." });
      await refresh();
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Upload failed: ${message}` });
      toast.error("Upload failed", { description: message });
    } finally {
      setUploading(false);
    }
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    await refresh();
    toast.success(tag.trim() ? "Search complete" : "Media refreshed");
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
      setNotice(null);
      toast.success("Tag-count query complete");
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Tag-count query failed: ${message}` });
      toast.error("Tag-count query failed", { description: message });
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
      const text = inferred ? `Query image analyzed: ${inferred}` : "No tags detected in query image.";
      setNotice({ tone: "success", text });
      toast.success("Query image analyzed", { description: inferred || "No tags detected." });
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Query file failed: ${message}` });
      toast.error("Query file failed", { description: message });
    } finally {
      setLoading(false);
    }
  }

  async function onThumbnailUrlLookup(event: FormEvent) {
    event.preventDefault();
    const value = thumbnailLookupUrl.trim();
    if (!value) {
      toast.error("Thumbnail URL is required.");
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
      setNotice(null);
      toast.success("Thumbnail resolved");
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Thumbnail lookup failed: ${message}` });
      toast.error("Thumbnail lookup failed", { description: message });
    } finally {
      setLoading(false);
    }
  }

  async function onBulkUpdate(event: FormEvent) {
    event.preventDefault();
    const tags = splitTags(bulkTags);
    if (selectedItems.length === 0) {
      toast.error("Select at least one media item.");
      return;
    }
    if (tags.length === 0) {
      toast.error("Enter at least one tag.");
      return;
    }
    if (!selectedCanEditTags) {
      toast.error("Selected media cannot be edited.");
      return;
    }
    const urls = selectedItems
      .map((item) => item.originalUrl || item.thumbnailUrl || item.storageObject)
      .filter((url): url is string => Boolean(url));
    const toastDescription = bulkTagToastDescription(selectedItems, tags, bulkOperation);
    setNotice({ tone: "info", text: "Updating tags..." });
    try {
      const updated = await bulkUpdateTags(
        selectedItems.map((item) => item.mediaId),
        urls,
        tags,
        bulkOperation === "1" ? 1 : 0,
      );
      const updatedById = new Map(updated.map((item) => [item.mediaId, item]));
      setItems((previous) => previous.map((item) => updatedById.get(item.mediaId) ?? item));
      setNotice(null);
      toast.success("Tags updated", {
        description: toastDescription,
      });
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Tag update failed: ${message}` });
      toast.error("Tag update failed", { description: message });
    }
  }

  async function performBulkDelete() {
    if (selectedItems.length === 0) return;
    if (!selectedCanDelete) {
      toast.error("Only media you own can be deleted.");
      return;
    }
    const urls = selectedItems
      .map((item) => item.originalUrl || item.thumbnailUrl || item.storageObject)
      .filter((url): url is string => Boolean(url));
    if (urls.length === 0) {
      toast.error("Select at least one media item with a URL.");
      return;
    }
    setNotice({ tone: "info", text: "Deleting selected media..." });
    try {
      const result = await bulkDeleteMedia(urls);
      setNotice(null);
      toast.success("Selected media deleted", { description: `${result.count} item(s) removed.` });
      setSelectedIds([]);
      await refresh();
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Bulk delete failed: ${message}` });
      toast.error("Bulk delete failed", { description: message });
    }
  }

  function toggleSelected(mediaId: string) {
    setSelectedIds((previous) =>
      previous.includes(mediaId) ? previous.filter((id) => id !== mediaId) : [...previous, mediaId],
    );
  }

  async function performDelete(mediaId: string) {
    const item = items.find((candidate) => candidate.mediaId === mediaId);
    if (item && !canDeleteMedia(item, user?.userId)) {
      toast.error("Only media you own can be deleted.");
      return;
    }
    setNotice({ tone: "info", text: "Deleting media..." });
    try {
      await deleteMedia(mediaId);
      setNotice(null);
      toast.success("Media deleted");
      await refresh();
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Delete failed: ${message}` });
      toast.error("Delete failed", { description: message });
    }
  }

  async function onThumbnailLookup(item: MediaItem) {
    if (!item.thumbnailUrl) return;
    setNotice({ tone: "info", text: "Resolving thumbnail..." });
    try {
      const result = await lookupOriginalByThumbnail(item.thumbnailUrl);
      if (result.originalUrl) {
        window.open(result.originalUrl, "_blank", "noopener,noreferrer");
        setNotice(null);
        toast.success("Original image URL resolved");
      } else {
        toast.error("Original image URL was not returned.");
      }
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Thumbnail lookup failed: ${message}` });
      toast.error("Thumbnail lookup failed", { description: message });
    }
  }

  async function onCopyUrl(label: string, url: string | null) {
    if (!url) {
      toast.error(`${label} URL is not available.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} URL copied.`);
    } catch (err) {
      toast.error("Copy failed", { description: errorMessage(err) });
    }
  }

  async function onUpdateSharing(
    item: MediaItem,
    visibility: "private" | "shared",
    allowTagEdit: boolean,
  ) {
    if (!isMediaOwner(item, user?.userId)) {
      toast.error("Only the owner can change sharing.");
      return;
    }
    setNotice({ tone: "info", text: "Updating sharing settings..." });
    try {
      const updated = await updateMediaSharing(item.mediaId, visibility, allowTagEdit);
      setItems((previous) =>
        previous.map((candidate) => (candidate.mediaId === updated.mediaId ? updated : candidate)),
      );
      setNotice(null);
      toast.success("Sharing settings updated");
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Sharing update failed: ${message}` });
      toast.error("Sharing update failed", { description: message });
    }
  }

  async function onCreateSubscription(event: FormEvent) {
    event.preventDefault();
    const tags = splitTags(subscriptionTags);
    if (!subscriptionEmail.trim() || tags.length === 0) {
      toast.error("Email and at least one tag are required.");
      return;
    }
    setNotice({ tone: "info", text: "Creating subscription..." });
    try {
      await createSubscription(subscriptionEmail.trim(), tags);
      setSubscriptionTags("");
      setNotice(null);
      toast.success("Subscription saved", {
        description: "Confirm the SNS email if this is a new address.",
      });
      await refresh();
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Subscription failed: ${message}` });
      toast.error("Subscription failed", { description: message });
    }
  }

  async function performDeleteSubscription(subscriptionId: string) {
    setNotice({ tone: "info", text: "Removing subscription..." });
    try {
      await deleteSubscription(subscriptionId);
      setNotice(null);
      toast.success("Subscription removed");
      await refresh();
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Remove failed: ${message}` });
      toast.error("Remove failed", { description: message });
    }
  }

  async function confirmDeleteTarget() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    if (target.kind === "single") await performDelete(target.mediaId);
    if (target.kind === "bulk") await performBulkDelete();
    if (target.kind === "subscription") await performDeleteSubscription(target.subscriptionId);
  }

  const dialogCopy = (() => {
    if (!deleteTarget) return null;
    if (deleteTarget.kind === "single") {
      return {
        title: `Delete ${shortId(deleteTarget.mediaId)}?`,
        description: "This removes originals, thumbnails, videos, database records, and dedup entries.",
        action: "Delete media",
      };
    }
    if (deleteTarget.kind === "bulk") {
      return {
        title: `Delete ${selectedItems.length} selected ${pluralize(selectedItems.length, "media item")}?`,
        description: "This removes selected originals, thumbnails, videos, database records, and dedup entries.",
        action: "Delete selected",
      };
    }
    return {
      title: "Remove subscription?",
      description: "This stops future email notifications for that saved subscription.",
      action: "Remove subscription",
    };
  })();

  return (
    <section className="workspace-page">
      <div className="workspace-topbar">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-emerald-950">Media workspace</h1>
            <Badge variant="secondary">Multi-cloud demo</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Signed in as {signedInLabel}
          </p>
        </div>

        <div className="workspace-summary">
          <SummaryPill label="Total" value={items.length} />
          <SummaryPill label="Processed" value={processedCount} />
          <SummaryPill label="Tags" value={tagCount} />
          <SummaryPill label="Subscriptions" value={subscriptions.length} />
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
            Refresh
          </Button>
        </div>
      </div>

      {notice && (
        <Alert variant={toneToAlert(notice.tone)}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      <div className="workspace-layout">
        <aside className="tool-panel">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-card/80 p-4">
              <div>
                <CardTitle className="text-lg">Tools</CardTitle>
                <CardDescription>Upload, search, manage tags and subscriptions.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <Tabs value={activeTool} onValueChange={(value) => setActiveTool(value as ToolTab)} className="w-full">
                <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1">
                  <TabsTrigger value="upload" className="gap-2">
                    <ImageUp className="size-4" />
                    <span className="hidden sm:inline">Upload</span>
                  </TabsTrigger>
                  <TabsTrigger value="search" className="gap-2">
                    <Search className="size-4" />
                    <span className="hidden sm:inline">Search</span>
                  </TabsTrigger>
                  <TabsTrigger value="manage" className="gap-2">
                    <Tags className="size-4" />
                    <span className="hidden sm:inline">Manage</span>
                  </TabsTrigger>
                  <TabsTrigger value="notify" className="gap-2">
                    <Bell className="size-4" />
                    <span className="hidden sm:inline">Notify</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="upload" className="mt-5 space-y-5">
                  <div className="space-y-1">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
                      <ImageUp className="size-5" /> Upload media
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Checksum is calculated in browser. Duplicate uploads are rejected before storage.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      After upload, processing may take 30-60 seconds. Status refreshes automatically; use Refresh for an immediate update.
                    </p>
                  </div>
                  <form className="space-y-4" onSubmit={onUpload}>
                    <Field label="Image or video">
                      <Input type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                    </Field>
                    {file && (
                      <div className="rounded-md border bg-muted/50 p-3 text-sm">
                        <p className="break-all font-medium">{file.name}</p>
                        <p className="text-muted-foreground">{Math.max(file.size / 1024 / 1024, 0.01).toFixed(2)} MB</p>
                      </div>
                    )}
                    <Button className="w-full" type="submit" disabled={!file || uploading}>
                      {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />}
                      {uploading ? "Uploading..." : "Upload"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="search" className="tool-grid mt-5">
                  <section className="tool-section">
                    <h2 className="tool-section-title">
                      <Search className="size-5" /> Search by species
                    </h2>
                    <form className="space-y-4" onSubmit={onSearch}>
                      <Field label="Tag">
                        <Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="felis_catus" />
                      </Field>
                      <Button className="w-full" type="submit">Search</Button>
                    </form>
                  </section>

                  <Separator className="tool-separator" />

                  <section className="tool-section">
                    <h2 className="tool-section-title">
                      <Tags className="size-5" /> Search by tag counts
                    </h2>
                    <form className="space-y-4" onSubmit={onTagCountSearch}>
                      <Field label="Query">
                        <Input value={tagCountQuery} onChange={(event) => setTagCountQuery(event.target.value)} placeholder="felis_catus:1, manual_verified:1" />
                      </Field>
                      <p className="text-xs text-muted-foreground">Multiple conditions use AND logic.</p>
                      <Button className="w-full" type="submit">Query</Button>
                    </form>
                  </section>

                  <Separator className="tool-separator" />

                  <section className="tool-section">
                    <h2 className="tool-section-title">
                      <FileImage className="size-5" /> Search by query image
                    </h2>
                    <form className="space-y-4" onSubmit={onQueryFile}>
                      <Field label="Image file">
                        <Input type="file" accept="image/*" onChange={(event) => setQueryFile(event.target.files?.[0] ?? null)} />
                      </Field>
                      <Button className="w-full" type="submit" disabled={!queryFile || loading}>Match</Button>
                    </form>
                  </section>

                  <Separator className="tool-separator" />

                  <section className="tool-section">
                    <h2 className="tool-section-title">
                      <ExternalLink className="size-5" /> Find original by thumbnail URL
                    </h2>
                    <form className="space-y-4" onSubmit={onThumbnailUrlLookup}>
                      <Field label="Thumbnail URL">
                        <Input value={thumbnailLookupUrl} onChange={(event) => setThumbnailLookupUrl(event.target.value)} placeholder="https://..." type="url" />
                      </Field>
                      <Button className="w-full" type="submit" disabled={loading}>Find original</Button>
                      {thumbnailLookupResult && (
                        <div className="rounded-md border bg-muted/50 p-3 text-sm">
                          <p className="font-medium">{shortId(thumbnailLookupResult.mediaId)}</p>
                          {thumbnailLookupResult.originalUrl ? (
                            <a href={thumbnailLookupResult.originalUrl} target="_blank" rel="noreferrer">Open original</a>
                          ) : (
                            <p className="break-all text-muted-foreground">{thumbnailLookupResult.storageObject}</p>
                          )}
                        </div>
                      )}
                    </form>
                  </section>
                </TabsContent>

                <TabsContent value="manage" className="mt-5 space-y-5">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
                      <Tags className="size-5" /> Bulk tags
                    </h2>
                  </div>
                  <form className="space-y-4" onSubmit={onBulkUpdate}>
                    <Field label="Tags">
                      <Input value={bulkTags} onChange={(event) => setBulkTags(event.target.value)} placeholder="reviewed, demo" />
                    </Field>
                    <Field label="Operation">
                      <Select value={bulkOperation} onValueChange={(value) => setBulkOperation(value as "1" | "0")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Add</SelectItem>
                          <SelectItem value="0">Remove</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Button className="w-full" type="submit" disabled={!selectedCanEditTags}>Apply tag change</Button>
                  </form>
                </TabsContent>

                <TabsContent value="notify" className="mt-5 space-y-5">
                  <div className="space-y-1">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
                      <Bell className="size-5" /> Notifications
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      You must confirm the AWS SNS email before notifications are delivered.
                    </p>
                  </div>
                  <form className="space-y-4" onSubmit={onCreateSubscription}>
                    <Field label="Email">
                      <Input value={subscriptionEmail} onChange={(event) => setSubscriptionEmail(event.target.value)} placeholder="name@example.com" type="email" />
                    </Field>
                    <Field label="Tags">
                      <Input value={subscriptionTags} onChange={(event) => setSubscriptionTags(event.target.value)} placeholder="alectura_lathami, felis_catus" />
                    </Field>
                    <Button className="w-full" type="submit">Subscribe</Button>
                  </form>

                  <div className="space-y-3">
                    {subscriptions.map((subscription) => (
                      <div className="rounded-md border p-3" key={subscription.subscriptionId}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <p className="break-all text-sm font-medium">{subscription.email}</p>
                            <p className="break-all text-xs text-muted-foreground">{subscription.tags.join(", ")}</p>
                            <Badge variant={subscriptionStatusVariant(subscription.snsStatus)}>
                              {subscriptionStatusLabel(subscription.snsStatus)}
                            </Badge>
                          </div>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget({ kind: "subscription", subscriptionId: subscription.subscriptionId })}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                    {subscriptions.length === 0 && (
                      <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">No active subscriptions.</div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </aside>

        <Card className="overflow-hidden">
          <CardHeader className="border-b bg-gradient-to-r from-emerald-50 to-background p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <FileImage className="size-6" />
                  Results
                </CardTitle>
                <CardDescription>
                  {items.length > 0
                    ? `${visibleItems.length} of ${items.length} ${pluralize(items.length, "media item")} visible. ${selectedItems.length} selected.`
                    : "Your media library will appear here after upload or search."}
                </CardDescription>
                <div className="mt-3 flex flex-wrap gap-2" aria-label="Media visibility filter" role="group">
                  {MEDIA_SCOPE_OPTIONS.map((option) => (
                    <Button
                      aria-pressed={mediaScope === option.value}
                      key={option.value}
                      onClick={() => {
                        setMediaScope(option.value);
                        setSelectedIds([]);
                      }}
                      size="sm"
                      type="button"
                      variant={mediaScope === option.value ? "secondary" : "ghost"}
                    >
                      {option.label}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {mediaScopeCounts[option.value]}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {loading && <Badge variant="secondary"><Loader2 className="mr-1 size-3 animate-spin" /> Loading</Badge>}
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={!selectedCanDelete}
                  onClick={() => setDeleteTarget({ kind: "bulk" })}
                >
                  <Trash2 />
                  {selectedItems.length > 0
                    ? `Delete ${selectedItems.length} selected`
                    : "Delete selected"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
            <div className="space-y-3">
              {visibleItems.map((item) => {
                const ownedByCurrentUser = isMediaOwner(item, user?.userId);
                const itemCanEditTags = canEditMediaTags(item, user?.userId);
                const itemCanDelete = canDeleteMedia(item, user?.userId);
                const itemVisibility = mediaVisibility(item);

                return (
                  <article className="media-card" key={item.mediaId}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 gap-4">
                        <Checkbox
                          aria-label={`Select ${item.mediaId}`}
                          checked={selectedIds.includes(item.mediaId)}
                          onCheckedChange={() => toggleSelected(item.mediaId)}
                          disabled={!itemCanEditTags && !itemCanDelete}
                          className="mt-1"
                        />
                        <div className="media-preview">
                          {item.thumbnailUrl || (item.originalUrl && item.mediaType === "image") ? (
                            <img src={item.thumbnailUrl || item.originalUrl || ""} alt={item.mediaId} />
                          ) : (
                            <span>{item.mediaType}</span>
                          )}
                        </div>
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-emerald-950">{shortId(item.mediaId)}</h3>
                            <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                            <Badge variant="outline">{item.mediaType}</Badge>
                            <Badge variant={itemVisibility === "shared" ? "success" : "secondary"}>
                              {itemVisibility === "shared" ? "Shared" : "Private"}
                            </Badge>
                            <Badge variant={itemVisibility === "shared" && item.allowTagEdit ? "success" : "secondary"}>
                              {itemVisibility === "shared"
                                ? item.allowTagEdit
                                  ? "Others can edit tags"
                                  : "View only"
                                : "Owner only"}
                            </Badge>
                            {!ownedByCurrentUser && <Badge variant="outline">Shared access</Badge>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(item.tagCounts || {}).length === 0 ? (
                              <Badge variant="secondary">No tags yet</Badge>
                            ) : (
                              Object.entries(item.tagCounts || {}).map(([tagName, count]) => (
                                <Badge variant="secondary" key={tagName}>{tagName} x{count}</Badge>
                              ))
                            )}
                          </div>
                          <details className="group rounded-md border bg-background/70 p-3">
                            <summary className="cursor-pointer text-sm font-semibold text-emerald-950">
                              Details
                            </summary>
                            <dl className="mt-3 grid gap-2">
                              <DetailRow label="Owner" value={item.ownerSub} />
                              <DetailRow label="Visibility" value={itemVisibility === "shared" ? "Shared" : "Private"} />
                              <DetailRow label="Allow tag edit" value={item.allowTagEdit} />
                              <DetailRow label="Original URL" value={item.originalUrl} />
                              <DetailRow label="Thumbnail URL" value={item.thumbnailUrl} />
                              <DetailRow label="Checksum" value={item.checksumSha256} />
                              <DetailRow label="Model version" value={item.modelVersion} />
                              <DetailRow label="Created at" value={item.createdAt} />
                              <DetailRow label="Updated at" value={item.updatedAt} />
                            </dl>
                          </details>
                          {item.status === "failed" && item.processingError && (
                            <Alert variant="destructive" className="mt-2">
                              <ShieldAlert className="size-4" />
                              <AlertDescription>{item.processingError}</AlertDescription>
                            </Alert>
                          )}
                          {ownedByCurrentUser && (
                            <div className="sharing-control">
                              <span>Sharing</span>
                              <Select
                                value={sharingMode(item)}
                                onValueChange={(value) => {
                                  const mode = value as SharingMode;
                                  void onUpdateSharing(
                                    item,
                                    mode === "private" ? "private" : "shared",
                                    mode === "shared_edit",
                                  );
                                }}
                              >
                                <SelectTrigger className="h-8 w-full sm:w-44">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="private">Private</SelectItem>
                                  <SelectItem value="shared">Shared</SelectItem>
                                  <SelectItem value="shared_edit">Shared + tag edit</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="media-actions">
                        {item.originalUrl && (
                          <Button asChild variant="outline" size="sm">
                            <a href={item.originalUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open original</a>
                          </Button>
                        )}
                        {item.thumbnailUrl && (
                          <Button type="button" variant="outline" size="sm" onClick={() => void onCopyUrl("Thumbnail", item.thumbnailUrl)}>
                            <Copy /> Copy thumb
                          </Button>
                        )}
                        {item.originalUrl && (
                          <Button type="button" variant="outline" size="sm" onClick={() => void onCopyUrl("Original", item.originalUrl)}>
                            <Copy /> Copy original
                          </Button>
                        )}
                        {item.mediaType === "image" && item.thumbnailUrl && (
                          <Button type="button" variant="outline" size="sm" onClick={() => void onThumbnailLookup(item)}>
                            <ExternalLink /> Lookup original
                          </Button>
                        )}
                        {itemCanDelete && (
                          <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget({ kind: "single", mediaId: item.mediaId })}>
                            <Trash2 /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {items.length === 0 && (
                <div className="rounded-xl border border-dashed bg-muted/20 p-10 text-center text-muted-foreground">
                  <FileImage className="mx-auto mb-3 size-10 opacity-50" />
                  <p className="font-medium text-foreground">No media yet</p>
                  <p className="mx-auto mt-1 max-w-md text-sm">
                    Upload an image or video to start species detection, then results and tags will appear in this panel.
                  </p>
                </div>
              )}
              {items.length > 0 && visibleItems.length === 0 && (
                <div className="rounded-xl border border-dashed bg-muted/20 p-10 text-center text-muted-foreground">
                  <FileImage className="mx-auto mb-3 size-10 opacity-50" />
                  <p className="font-medium text-foreground">No media in this view</p>
                  <p className="mx-auto mt-1 max-w-md text-sm">
                    Switch to All visible or adjust the current search to see more accessible media.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialogCopy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void confirmDeleteTarget()}>
              {dialogCopy?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
