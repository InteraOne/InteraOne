import type { FormEvent } from "react";
import { KeyRound, Mail } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";

type PortalAuthDialogProps = {
  open: boolean;
  organizationName?: string;
  email: string;
  sent: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onEmailChange: (email: string) => void;
  onSubmit: (code: FormDataEntryValue | null) => void;
  onResetCode: () => void;
};

export function PortalAuthDialog({
  open,
  organizationName,
  email,
  sent,
  busy,
  onOpenChange,
  onEmailChange,
  onSubmit,
  onResetCode,
}: PortalAuthDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(new FormData(event.currentTarget).get("code"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            {sent ? (
              <KeyRound className="size-5" />
            ) : (
              <Mail className="size-5" />
            )}
          </div>
          <DialogTitle>Sign in to {organizationName || "Threads"}</DialogTitle>
          <DialogDescription>
            {sent
              ? `Enter the six-digit code sent to ${email}.`
              : "Access private support requests, replies, and followed updates."}
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-2 text-sm font-medium">
            Email address
            <Input
              type="email"
              required
              value={email}
              disabled={sent}
              autoComplete="email"
              onChange={(event) => onEmailChange(event.target.value)}
            />
          </label>
          {sent && (
            <label className="grid gap-2 text-sm font-medium">
              Sign-in code
              <Input
                name="code"
                inputMode="numeric"
                required
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                placeholder="000000"
                autoFocus
              />
            </label>
          )}
          <Button disabled={busy} className="w-full">
            {sent ? "Verify and continue" : "Send sign-in code"}
          </Button>
          {sent && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onResetCode}
            >
              Use a different email
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
