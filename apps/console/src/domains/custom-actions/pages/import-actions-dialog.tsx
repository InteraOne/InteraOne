import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { FileJson, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { customActionsApi } from "../api/custom-actions.api";
import { customActionKeys } from "../hooks/use-custom-actions";
import type { CustomActionAuthType } from "../types/types";

export function ImportActionsDialog() {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [type, setType] = useState<CustomActionAuthType>("none");
  const [placement, setPlacement] = useState<"header" | "query">("header");
  const [name, setName] = useState("X-API-Key");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const importSpec = useMutation({
    mutationFn: () => customActionsApi.importSpec(spec, baseUrl, {
      type,
      ...(type === "api_key" && { placement, keyName: name, credentials: { value: secret } }),
      ...(type === "bearer" && { credentials: { token: secret } }),
      ...(type === "basic" && { credentials: { username, password: secret } }),
    }),
    onSuccess: (result) => {
      toast.success(`${result.count} ${result.count === 1 ? "action" : "actions"} imported`, {
        description: result.skipped.length ? `${result.skipped.length} unsupported operations were skipped.` : "Imported actions are disabled by default.",
      });
      setSpec("");
      setBaseUrl("");
      setSecret("");
      setOpen(false);
      void client.invalidateQueries({ queryKey: customActionKeys.all });
    },
    onError: (error) => toast.error("Import failed", { description: error.message }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Upload className="mr-2 h-4 w-4" />Import OpenAPI</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><FileJson className="h-5 w-5 text-primary" /></div>
          <DialogTitle>Import API actions</DialogTitle>
          <DialogDescription>Paste an OpenAPI 3.x or Swagger 2.0 specification. Actions are reviewed and imported disabled by default.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); importSpec.mutate(); }}>
          <label className="block space-y-2 text-sm font-medium">
            <span>API specification</span>
            <Textarea required maxLength={1_000_000} rows={10} value={spec} onChange={(event) => setSpec(event.target.value)} className="font-mono text-xs" placeholder={'openapi: 3.0.3\nservers:\n  - url: https://api.example.com\npaths: ...'} />
            <span className="block text-xs font-normal text-muted-foreground">JSON or YAML, up to 1 MB</span>
          </label>
          <label className="block space-y-2 text-sm font-medium">
            <span>Base URL override <span className="font-normal text-muted-foreground">(optional)</span></span>
            <Input type="url" placeholder="https://api.example.com" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
            <span className="block text-xs font-normal text-muted-foreground">Use this when the specification has no server URL or needs a different environment.</span>
          </label>
          <div className="space-y-4 rounded-lg border border-border/70 bg-muted/20 p-4">
          <label className="block space-y-2 text-sm font-medium">
            <span>Authentication</span>
            <select className="block h-10 w-full rounded-md border border-input bg-background px-3 font-normal" value={type}
              onChange={(event) => { setType(event.target.value as CustomActionAuthType); setSecret(""); }}>
              <option value="none">No auth</option>
              <option value="api_key">API key</option>
              <option value="bearer">Bearer token</option>
              <option value="basic">Basic auth</option>
            </select>
          </label>
          {type === "api_key" && <>
            <label className="block space-y-2 text-sm font-medium">API key name<Input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="block space-y-2 text-sm font-medium">API key placement
              <select className="block h-10 w-full rounded-md border border-input bg-background px-3 font-normal" value={placement} onChange={(event) => setPlacement(event.target.value as typeof placement)}>
                <option value="header">Header</option><option value="query">Query parameter</option>
              </select>
            </label>
          </>}
          {type === "basic" && <label className="block space-y-2 text-sm font-medium">Username<Input required value={username} onChange={(event) => setUsername(event.target.value)} /></label>}
          {type !== "none" && <label className="block space-y-2 text-sm font-medium">
            {type === "basic" ? "Password" : type === "bearer" ? "Token" : "API key"}
            <Input required type="password" value={secret} onChange={(event) => setSecret(event.target.value)} />
          </label>}
          </div>
          <DialogFooter className="gap-2 border-t border-border/70 pt-4 sm:space-x-0">
            <Button type="button" variant="outline" disabled={importSpec.isPending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={importSpec.isPending || !spec.trim()}>{importSpec.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{importSpec.isPending ? "Importing…" : "Import actions"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
