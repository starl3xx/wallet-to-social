'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import {
  ArrowSquareOut,
  DownloadSimple as Download,
  ArrowsClockwise as RefreshCw,
  CheckCircle as CheckCircle2,
  XCircle,
  WarningCircle as AlertCircle,
  Eye,
  EyeSlash as EyeOff,
  CircleNotch as Loader2,
  CaretRight as ChevronRight,
  CaretLeft as ChevronLeft,
  Key,
  ChatText as MessageSquare,
  Play,
  Square,
} from '@phosphor-icons/react';
import type { WalletSocialResult } from '@/lib/types';
import {
  extractDMRecipients,
  renderTemplate,
  sendBatchDMs,
  exportLogAsCSV,
  validateApiKey,
  testApiKey,
  type DMRecipient,
  type DMProgress,
} from '@/lib/farcaster-dm';

interface FarcasterDMModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: WalletSocialResult[];
}

type Step = 'configure' | 'preview' | 'sending' | 'complete';

const MAX_MESSAGE_LENGTH = 500;
const API_KEY_STORAGE_KEY = 'warpcast_api_key';

/**
 * The figure treatment from `Figure`: 200 at title tracking, the hero-figure
 * weight everywhere a figure stands alone at 24px and up, with tabular digits
 * because these tick every 250ms and proportional digits make a counting
 * number wobble. They were `font-bold`, which is 700 and not one of the five
 * weights, and the final pair was a size up from the live three for no reason
 * the layout could state. Colour does the sorting: the sent count is the
 * outcome and takes `attested`, failed takes `destructive`, the rest is plain.
 */
const TILE_FIGURE =
  'text-2xl font-extralight tabular-nums tracking-[var(--tracking-title)]';

export function FarcasterDMModal({
  open,
  onOpenChange,
  results,
}: FarcasterDMModalProps) {
  // Step state
  const [step, setStep] = useState<Step>('configure');

  // Configuration state
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [saveApiKey, setSaveApiKey] = useState(false);
  const [message, setMessage] = useState('');
  const [testingKey, setTestingKey] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Sending state
  const [progress, setProgress] = useState<DMProgress | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Extract eligible recipients
  const recipients = useMemo(() => extractDMRecipients(results), [results]);

  // Load the saved key when the dialog opens, and reset everything when it
  // closes. Both run from one effect's cleanup rather than as synchronous
  // setState calls in the effect body, which React flags as a cascading
  // render. The cleanup runs on the open → closed edge, which is exactly when
  // the reset is wanted; the load runs on the closed → open edge, deferred a
  // tick so it is not a render-phase write either.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const saved = localStorage.getItem(API_KEY_STORAGE_KEY);
      if (saved) {
        setApiKey(saved);
        setSaveApiKey(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(id);
      setStep('configure');
      setProgress(null);
      setKeyValid(null);
      setKeyError(null);
      setTestingKey(false);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [open]);

  // Test API key
  const handleTestKey = useCallback(async () => {
    if (!apiKey.trim()) return;

    if (!validateApiKey(apiKey)) {
      setKeyError('Invalid API key format');
      setKeyValid(false);
      return;
    }

    setTestingKey(true);
    setKeyError(null);
    setKeyValid(null);

    const result = await testApiKey(apiKey);

    setTestingKey(false);
    setKeyValid(result.valid);
    setKeyError(result.valid ? null : result.error || 'Invalid API key');
  }, [apiKey]);

  // Move to preview step
  const handleContinueToPreview = useCallback(() => {
    if (saveApiKey) {
      localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
    setStep('preview');
  }, [apiKey, saveApiKey]);

  // Start sending DMs
  const handleStartSending = useCallback(async () => {
    setStep('sending');
    abortControllerRef.current = new AbortController();

    await sendBatchDMs(
      apiKey,
      recipients,
      message,
      setProgress,
      abortControllerRef.current.signal
    );

    setStep('complete');
  }, [apiKey, recipients, message]);

  // Cancel sending
  const handleCancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  // Retry failed DMs
  const handleRetryFailed = useCallback(async () => {
    if (!progress?.failedRecipients.length) return;

    setStep('sending');
    abortControllerRef.current = new AbortController();

    await sendBatchDMs(
      apiKey,
      progress.failedRecipients,
      message,
      (newProgress) => {
        setProgress((prev) => ({
          ...newProgress,
          // Add previous sent count to new progress
          sent:
            (prev?.sent || 0) -
            (prev?.failedRecipients.length || 0) +
            newProgress.sent,
          log: [
            ...(prev?.log || []).filter((l) => l.status === 'sent'),
            ...newProgress.log,
          ],
        }));
      },
      abortControllerRef.current.signal
    );

    setStep('complete');
  }, [apiKey, message, progress]);

  // Download log as CSV
  const handleDownloadLog = useCallback(() => {
    if (!progress?.log.length) return;

    const csv = exportLogAsCSV(progress.log);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `farcaster-dm-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [progress]);

  // Preview message - prefer recipient with holdings data if available
  const previewRecipient = useMemo(() => {
    if (recipients.length === 0) return null;
    // Find first recipient with holdings, or fall back to first
    return recipients.find((r) => r.holdings !== undefined) || recipients[0];
  }, [recipients]);

  const previewMessage = useMemo(() => {
    if (!previewRecipient) return message;
    return renderTemplate(message, previewRecipient);
  }, [message, previewRecipient]);

  // Can proceed to next step?
  const canContinue = apiKey.trim().length > 0 && message.trim().length > 0;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-2xl">
        <ModalHeader>
          <ModalTitle>Send Farcaster DMs</ModalTitle>
          <ModalDescription>
            Send personalized direct messages to{' '}
            {recipients.length.toLocaleString()} Farcaster users in your results
          </ModalDescription>
        </ModalHeader>

        {/* Step indicator. No margin of its own: the body is a flex column
            with `gap-4`, and a margin here stacked on it to 32px. */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={
              step === 'configure' ? 'text-foreground font-medium' : ''
            }
          >
            1. Configure
          </span>
          <ChevronRight className="h-4 w-4" />
          <span
            className={step === 'preview' ? 'text-foreground font-medium' : ''}
          >
            2. Preview
          </span>
          <ChevronRight className="h-4 w-4" />
          <span
            className={step === 'sending' ? 'text-foreground font-medium' : ''}
          >
            3. Send
          </span>
          <ChevronRight className="h-4 w-4" />
          <span
            className={step === 'complete' ? 'text-foreground font-medium' : ''}
          >
            4. Done
          </span>
        </div>

        {/* Step 1: Configure */}
        {step === 'configure' && (
          <div className="space-y-6">
            {/* API Key Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-muted-foreground" />
                <label
                  htmlFor="warpcast-api-key"
                  className="text-sm font-medium"
                >
                  Warpcast API key
                </label>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="warpcast-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyValid(null);
                      setKeyError(null);
                    }}
                    placeholder="Enter your Warpcast API key"
                    className="pr-10"
                  />
                  {/* Named by function, not by the icon: a screen reader hears
                      "Show API key", and aria-pressed says whether it is. The
                      ghost Button brings the focus ring and transition-control
                      with it. `h-7 w-7` rather than the 34px icon control: a
                      control nested inside a 34px field needs air on both
                      edges, and a utility beats the components-layer height. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowApiKey(!showApiKey)}
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    aria-pressed={showApiKey}
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTestKey}
                  disabled={!apiKey.trim() || testingKey}
                >
                  {testingKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : keyValid === true ? (
                    // A key that passed its test is a measured fact, so it is
                    // green. Violet would call the result an affordance.
                    <CheckCircle2 className="h-4 w-4 text-attested" />
                  ) : keyValid === false ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    'Test'
                  )}
                </Button>
              </div>

              {keyError && (
                <p className="flex items-center gap-1 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {keyError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="saveApiKey"
                  checked={saveApiKey}
                  onChange={(e) => setSaveApiKey(e.target.checked)}
                  className="rounded-sm"
                />
                <label
                  htmlFor="saveApiKey"
                  className="text-sm text-muted-foreground"
                >
                  Save API key for next time
                </label>
              </div>

              {/* Instructions */}
              <div className="p-3 bg-muted rounded-lg text-sm space-y-2">
                <p className="font-medium">How to get your API key:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>
                    Go to{' '}
                    {/* The one text-link treatment, and the one leave-site
                        glyph at its one size. `size-3` is `h-3 w-3`; Button
                        sizes any SVG child without a `size-` class to 16px,
                        and that rule outranks the icon's own classes. `gap-1`
                        because a button's 8px is too wide for an arrow after
                        a word. */}
                    <Button
                      asChild
                      variant="link"
                      size="inline"
                      className="gap-1"
                    >
                      <a
                        href="https://warpcast.com/~/developers/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        warpcast.com/~/developers/api-keys
                        <ArrowSquareOut className="size-3" aria-hidden />
                      </a>
                    </Button>
                  </li>
                  <li>Sign in with your Farcaster account</li>
                  <li>Create a new API key and paste it here</li>
                </ol>
                <p className="text-xs text-muted-foreground mt-2">
                  Your API key is stored locally in your browser and never sent
                  to our servers.
                </p>
              </div>
            </div>

            {/* Message Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <label htmlFor="dm-message" className="text-sm font-medium">
                  Message
                </label>
              </div>

              <div className="relative">
                {/* The Textarea primitive owns the edge (`border-input`, 3:1),
                    the focus ring and the placeholder token. A bare `border`
                    here resolved to the decorative `--border` at 1.26:1, so
                    the empty field had no visible boundary. */}
                <Textarea
                  id="dm-message"
                  value={message}
                  onChange={(e) =>
                    setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))
                  }
                  placeholder={`Hey {{username}}! I noticed you hold some tokens...`}
                  className="h-32 resize-none"
                />
                <span className="absolute bottom-2 right-2 text-xs tabular-nums text-muted-foreground">
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>

              {/* These insert text, so they are controls and take the outline
                  pill: border, focus ring, press. They wore the Badge recipe
                  (chip radius, tint, no border, mono), which says "fact" to
                  anyone who has learned the product's other badges. Mono
                  stays, because a template token is machine data in its own
                  element. */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Variables:</span>
                {['{{username}}', '{{holdings}}', '{{ens}}', '{{wallet}}'].map(
                  (v) => (
                    <Button
                      key={v}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="font-mono text-xs"
                      onClick={() => setMessage((m) => m + v)}
                    >
                      {v}
                    </Button>
                  )
                )}
              </div>
            </div>

            {/* Every action row in this dialog is a ModalFooter, inline in
                the body: one layout, primary at the right, stacking on a
                phone. No margin on the icons; Button's `gap-2` owns that. */}
            <ModalFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleContinueToPreview} disabled={!canContinue}>
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            </ModalFooter>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recipients</span>
                <span className="font-medium">
                  {recipients.length.toLocaleString()} users
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Estimated time</span>
                <span className="font-medium">
                  ~{Math.ceil((recipients.length * 250) / 60000)} minutes
                </span>
              </div>
            </div>

            {/* Preview message */}
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Preview (for @{previewRecipient?.username}):
              </p>
              <div className="p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap border">
                {previewMessage || (
                  <span className="text-muted-foreground italic">
                    Empty message
                  </span>
                )}
              </div>
              {previewRecipient && (
                <p className="text-xs text-muted-foreground">
                  Data for this user: username=“{previewRecipient.username}”
                  {previewRecipient.holdings !== undefined &&
                    `, holdings=${previewRecipient.holdings.toLocaleString()}`}
                  {previewRecipient.ens && `, ens="${previewRecipient.ens}"`}
                  {!previewRecipient.holdings &&
                    !previewRecipient.ens &&
                    ' (no holdings/ENS data)'}
                </p>
              )}
            </div>

            {/* Warning. A full-opacity tint and no border: it carried a
                `/30` border, which the elevation rule bans. */}
            <div className="rounded-lg bg-caution-tint p-3 text-sm text-caution">
              <p className="font-medium flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                Keep this tab open
              </p>
              <p className="mt-1 text-caution">
                DMs are sent from your browser. Closing this tab will stop the
                process.
              </p>
            </div>

            <ModalFooter>
              <Button variant="outline" onClick={() => setStep('configure')}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleStartSending}>
                <Play className="h-4 w-4" />
                Start sending
              </Button>
            </ModalFooter>
          </div>
        )}

        {/* Step 3: Sending */}
        {step === 'sending' && progress && (
          <div className="space-y-6">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>
                  Sending to{' '}
                  <span className="font-medium">
                    @{progress.currentUsername}
                  </span>
                </span>
                <span className="tabular-nums">
                  {progress.sent + progress.failed} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-accent-brand h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${((progress.sent + progress.failed) / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Stats. Sent is the outcome and is green: a DM that went is a
                measured fact, and violet would have called it an affordance. */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className={`${TILE_FIGURE} text-attested`}>
                  {progress.sent}
                </div>
                <div className="text-xs text-muted-foreground">Sent</div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className={`${TILE_FIGURE} text-destructive`}>
                  {progress.failed}
                </div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <div className={TILE_FIGURE}>
                  {progress.total - progress.sent - progress.failed}
                </div>
                <div className="text-xs text-muted-foreground">Remaining</div>
              </div>
            </div>

            {/* Recent log entries */}
            <div className="max-h-32 overflow-y-auto border rounded-lg">
              {progress.log
                .slice(-5)
                .reverse()
                .map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-b-0"
                  >
                    {entry.status === 'sent' ? (
                      <CheckCircle2 className="h-4 w-4 flex-none text-attested" />
                    ) : (
                      <XCircle className="h-4 w-4 flex-none text-destructive" />
                    )}
                    <span className="font-medium">@{entry.username}</span>
                    {entry.error && (
                      <span className="text-muted-foreground truncate">
                        {entry.error}
                      </span>
                    )}
                  </div>
                ))}
            </div>

            <ModalFooter>
              <Button variant="outline" onClick={handleCancel}>
                <Square className="h-4 w-4" />
                Stop sending
              </Button>
            </ModalFooter>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 'complete' && progress && (
          <div className="space-y-6">
            {/* Summary */}
            {/* A display moment, so `h-10 w-10` duotone: the icon scale has
                no 48px step. Every DM sent is a measured outcome, so the
                check is green. */}
            <div className="space-y-2 text-center">
              {progress.status === 'cancelled' ? (
                <AlertCircle
                  className="mx-auto h-10 w-10 text-caution"
                  weight="duotone"
                />
              ) : progress.failed === 0 ? (
                <CheckCircle2
                  className="mx-auto h-10 w-10 text-attested"
                  weight="duotone"
                />
              ) : (
                <AlertCircle
                  className="mx-auto h-10 w-10 text-caution"
                  weight="duotone"
                />
              )}
              <h3 className="text-xl font-semibold">
                {progress.status === 'cancelled'
                  ? 'Sending cancelled'
                  : progress.failed === 0
                    ? 'All DMs sent successfully'
                    : 'Sending complete with some failures'}
              </h3>
            </div>

            {/* Final stats, on the same figure as the live three. The tints
                are the full-opacity tokens: the sent tile was a `/30` wash
                of the brand tint and the failed tile a `/10` wash of the
                solid red, and a banner is one tint, not a mix. */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-attested-tint p-4 text-center">
                <div className={`${TILE_FIGURE} text-attested`}>
                  {progress.sent}
                </div>
                <div className="text-sm text-attested">Sent successfully</div>
              </div>
              <div className="rounded-lg bg-destructive-tint p-4 text-center">
                <div className={`${TILE_FIGURE} text-destructive`}>
                  {progress.failed}
                </div>
                <div className="text-sm text-destructive">Failed</div>
              </div>
            </div>

            {/* One action row: the two outline alternates to the left of the
                one filled primary. They were a centred cluster with Done
                centred on its own row beneath. At most three controls, so no
                overflow menu is needed. */}
            <ModalFooter>
              <Button variant="outline" onClick={handleDownloadLog}>
                <Download className="h-4 w-4" />
                Download log (CSV)
              </Button>
              {progress.failedRecipients.length > 0 && (
                <Button variant="outline" onClick={handleRetryFailed}>
                  <RefreshCw className="h-4 w-4" />
                  Retry {progress.failedRecipients.length} failed
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </ModalFooter>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
