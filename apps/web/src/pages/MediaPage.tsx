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
type DeleteTarget =
  | { kind: "single"; mediaId: string }
  | { kind: "bulk" }
  | { kind: "subscription"; subscriptionId: string }
  | null;

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
  if (Object.keys(out).length === 0) throw new Error("At least one tag is required.");
  return out;
}

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}...${id.slice(-6)}` : id;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function statusVariant(status: string): "success" | "warning" | "destructive" | "secondary" {
  if (status === "processed") return "success";
  if (status === "failed") return "destructive";
  if (PENDING_MEDIA_STATUSES.has(status)) return "warning";
  return "secondary";
}

function toneToAlert(tone: NonNullable<Notice>["tone"]): "default" | "destructive" | "success" | "info" {
  if (tone === "error") return "destructive";
  if (tone === "success") return "success";
  return "info";
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-950">{value}</p>
      </CardContent>
    </Card>
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
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const processedCount = useMemo(
    () => items.filter((item) => item.status === "processed").length,
    [items],
  );
  const tagCount = useMemo(() => new Set(items.flatMap((item) => item.tags || [])).size, [items]);
  const hasPendingMedia = useMemo(
    () => items.some((item) => PENDING_MEDIA_STATUSES.has(item.status)),
    [items],
  );
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.mediaId)),
    [items, selectedIds],
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
        setNotice({ tone: "success", text: "Duplicate detected. Existing media record was reused." });
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
      setNotice({ tone: "success", text: "Upload complete. Processing may take a few seconds." });
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
      setNotice({ tone: "success", text: "Tag-count query complete." });
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
      setNotice({ tone: "success", text: "Thumbnail resolved in this account." });
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
    if (selectedIds.length === 0) {
      toast.error("Select at least one media item.");
      return;
    }
    if (tags.length === 0) {
      toast.error("Enter at least one tag.");
      return;
    }
    const selectedItems = items.filter((item) => selectedIds.includes(item.mediaId));
    const urls = selectedItems
      .map((item) => item.originalUrl || item.thumbnailUrl || item.storageObject)
      .filter((url): url is string => Boolean(url));
    setNotice({ tone: "info", text: "Updating tags..." });
    try {
      const updated = await bulkUpdateTags(
        selectedIds,
        urls,
        tags,
        bulkOperation === "1" ? 1 : 0,
      );
      const updatedById = new Map(updated.map((item) => [item.mediaId, item]));
      setItems((previous) => previous.map((item) => updatedById.get(item.mediaId) ?? item));
      setNotice({ tone: "success", text: "Tags updated." });
      toast.success("Tags updated", {
        description:
          bulkOperation === "1"
            ? "Added tags are set to at least x1."
            : "Missing tags are ignored safely.",
      });
    } catch (err) {
      const message = errorMessage(err);
      setNotice({ tone: "error", text: `Tag update failed: ${message}` });
      toast.error("Tag update failed", { description: message });
    }
  }

  async function performBulkDelete() {
    if (selectedItems.length === 0) return;
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
      setNotice({ tone: "success", text: `${result.count} media item(s) deleted.` });
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
    setNotice({ tone: "info", text: "Deleting media..." });
    try {
      await deleteMedia(mediaId);
      setNotice({ tone: "success", text: "Media deleted." });
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
        setNotice({ tone: "success", text: "Original image URL resolved." });
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
      setNotice({ tone: "success", text: "Subscription saved. Confirm the SNS email if this is a new address." });
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
      setNotice({ tone: "success", text: "Subscription removed." });
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
        description: "This permanently removes the original media file, thumbnail, and database record.",
        action: "Delete media",
      };
    }
    if (deleteTarget.kind === "bulk") {
      return {
        title: `Delete ${selectedItems.length} selected ${pluralize(selectedItems.length, "media item")}?`,
        description: "This permanently removes every selected media file, thumbnail, and related database record.",
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
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Badge variant="secondary" className="mb-3">Multi-cloud serverless demo</Badge>
          <h1 className="text-3xl font-bold tracking-tight text-emerald-950">Media workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.username ?? "Cognito user"}</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total media" value={items.length} />
        <MetricCard label="Processed" value={processedCount} />
        <MetricCard label="Unique tags" value={tagCount} />
        <MetricCard label="Subscriptions" value={subscriptions.length} />
      </div>

      {notice && (
        <Alert variant={toneToAlert(notice.tone)}>
          <AlertDescription>{notice.text}</AlertDescription>
        </Alert>
      )}

      <div className="workspace-grid">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ImageUp className="size-5" /> Upload</CardTitle>
            <CardDescription>Upload image or short video media to S3.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onUpload}>
              <Field label="Image or video">
                <Input type="file" accept="image/*,video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </Field>
              {file && (
                <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                  <p className="font-medium break-all">{file.name}</p>
                  <p className="text-muted-foreground">{Math.max(file.size / 1024 / 1024, 0.01).toFixed(2)} MB</p>
                </div>
              )}
              <Button className="w-full" type="submit" disabled={!file || uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />}
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Search className="size-5" /> Search</CardTitle>
            <CardDescription>Find media containing one species tag.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSearch}>
              <Field label="Tag">
                <Input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="alectura_lathami" />
              </Field>
              <Button className="w-full" type="submit">Search</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Tags className="size-5" /> Tag counts</CardTitle>
            <CardDescription>Use AND semantics with minimum counts.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onTagCountSearch}>
              <Field label="Query">
                <Input value={tagCountQuery} onChange={(event) => setTagCountQuery(event.target.value)} placeholder="dingo:2, cattle:1" />
              </Field>
              <Button className="w-full" type="submit">Query</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileImage className="size-5" /> Query image</CardTitle>
            <CardDescription>Analyze a temporary image without storing it.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onQueryFile}>
              <Field label="Image file">
                <Input type="file" accept="image/*" onChange={(event) => setQueryFile(event.target.files?.[0] ?? null)} />
              </Field>
              <Button className="w-full" type="submit" disabled={!queryFile || loading}>Match</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Thumbnail lookup</CardTitle>
            <CardDescription>Resolve a thumbnail URL to its original image.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onThumbnailUrlLookup}>
              <Field label="Thumbnail URL">
                <Input value={thumbnailLookupUrl} onChange={(event) => setThumbnailLookupUrl(event.target.value)} placeholder="https://..." type="url" />
              </Field>
              <Button className="w-full" type="submit" disabled={loading}>Find original</Button>
              {thumbnailLookupResult && (
                <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                  <p className="font-medium">{shortId(thumbnailLookupResult.mediaId)}</p>
                  {thumbnailLookupResult.originalUrl ? (
                    <a href={thumbnailLookupResult.originalUrl} target="_blank" rel="noreferrer">Open original</a>
                  ) : (
                    <p className="break-all text-muted-foreground">{thumbnailLookupResult.storageObject}</p>
                  )}
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bulk tags</CardTitle>
            <CardDescription>Add or remove tags from selected media.</CardDescription>
          </CardHeader>
          <CardContent>
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
              <Button className="w-full" type="submit">Apply tag change</Button>
              <Separator />
              <Button
                className="w-full"
                type="button"
                variant="destructive"
                disabled={selectedIds.length === 0}
                onClick={() => setDeleteTarget({ kind: "bulk" })}
              >
                <Trash2 />
                {selectedIds.length > 0
                  ? `Delete ${selectedIds.length} selected ${pluralize(selectedIds.length, "media item")}`
                  : "Delete selected media"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bell className="size-5" /> Notifications</CardTitle>
            <CardDescription>Subscribe to owner-scoped tag notifications.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onCreateSubscription}>
              <Field label="Email">
                <Input value={subscriptionEmail} onChange={(event) => setSubscriptionEmail(event.target.value)} placeholder="name@example.com" type="email" />
              </Field>
              <Field label="Tags">
                <Input value={subscriptionTags} onChange={(event) => setSubscriptionTags(event.target.value)} placeholder="alectura_lathami, felis_catus" />
              </Field>
              <Button className="w-full" type="submit">Subscribe</Button>
            </form>

            <div className="mt-5 space-y-3">
              {subscriptions.map((subscription) => (
                <div className="rounded-lg border p-3" key={subscription.subscriptionId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="break-all text-sm font-medium">{subscription.email}</p>
                      <p className="break-all text-xs text-muted-foreground">{subscription.tags.join(", ")}</p>
                      {subscription.snsStatus && <Badge variant="secondary">SNS: {subscription.snsStatus}</Badge>}
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget({ kind: "subscription", subscriptionId: subscription.subscriptionId })}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              {subscriptions.length === 0 && (
                <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No active subscriptions.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : "Search and upload results appear here."}
            </CardDescription>
          </div>
          {loading && <Badge variant="secondary"><Loader2 className="mr-1 size-3 animate-spin" /> Loading</Badge>}
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {items.map((item) => (
              <article className="rounded-xl border bg-card p-4 shadow-sm" key={item.mediaId}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <Checkbox
                      aria-label={`Select ${item.mediaId}`}
                      checked={selectedIds.includes(item.mediaId)}
                      onCheckedChange={() => toggleSelected(item.mediaId)}
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
                      </div>
                      <p className="break-all text-sm text-muted-foreground">{item.storageObject}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(item.tagCounts || {}).length === 0 ? (
                          <Badge variant="secondary">No tags yet</Badge>
                        ) : (
                          Object.entries(item.tagCounts || {}).map(([tagName, count]) => (
                            <Badge variant="secondary" key={tagName}>{tagName} x{count}</Badge>
                          ))
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Model: {item.modelVersion}</p>
                      {item.status === "failed" && item.processingError && (
                        <Alert variant="destructive" className="mt-2">
                          <ShieldAlert className="size-4" />
                          <AlertDescription>{item.processingError}</AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    {item.originalUrl && (
                      <Button asChild variant="outline" size="sm">
                        <a href={item.originalUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open</a>
                      </Button>
                    )}
                    {item.thumbnailUrl && (
                      <Button type="button" variant="outline" size="sm" onClick={() => void onCopyUrl("Thumbnail", item.thumbnailUrl)}>
                        <Copy /> Thumbnail
                      </Button>
                    )}
                    {item.originalUrl && (
                      <Button type="button" variant="outline" size="sm" onClick={() => void onCopyUrl("Original", item.originalUrl)}>
                        <Copy /> Original
                      </Button>
                    )}
                    {item.mediaType === "image" && item.thumbnailUrl && (
                      <Button type="button" variant="outline" size="sm" onClick={() => void onThumbnailLookup(item)}>
                        Lookup original
                      </Button>
                    )}
                    <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget({ kind: "single", mediaId: item.mediaId })}>
                      <Trash2 /> Delete
                    </Button>
                  </div>
                </div>
              </article>
            ))}
            {items.length === 0 && (
              <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
                <FileImage className="mx-auto mb-3 size-10 opacity-50" />
                <p>No media found.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
