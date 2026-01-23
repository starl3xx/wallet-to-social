'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Send,
  Download,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Key,
  MessageSquare,
  Play,
  Square,
} from 'lucide-react';
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

export function FarcasterDMModal({ open, onOpenChange, results }: FarcasterDMModalProps) {
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

  // Load saved API key on mount
  useEffect(() => {
    if (open) {
      const saved = localStorage.getItem(API_KEY_STORAGE_KEY);
      if (saved) {
        setApiKey(saved);
        setSaveApiKey(true);
      }
    }
  }, [open]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setStep('configure');
      setProgress(null);
      setKeyValid(null);
      setKeyError(null);
      setTestingKey(false);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    }
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
          sent: (prev?.sent || 0) - (prev?.failedRecipients.length || 0) + newProgress.sent,
          log: [...(prev?.log || []).filter((l) => l.status === 'sent'), ...newProgress.log],
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
    return recipients.find(r => r.holdings !== undefined) || recipients[0];
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
          <ModalTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-purple-500" />
            Send Farcaster DMs
          </ModalTitle>
          <ModalDescription>
            Send personalized direct messages to {recipients.length.toLocaleString()} Farcaster users in your results
          </ModalDescription>
        </ModalHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <span className={step === 'configure' ? 'text-foreground font-medium' : ''}>
            1. Configure
          </span>
          <ChevronRight className="h-4 w-4" />
          <span className={step === 'preview' ? 'text-foreground font-medium' : ''}>
            2. Preview
          </span>
          <ChevronRight className="h-4 w-4" />
          <span className={step === 'sending' ? 'text-foreground font-medium' : ''}>
            3. Send
          </span>
          <ChevronRight className="h-4 w-4" />
          <span className={step === 'complete' ? 'text-foreground font-medium' : ''}>
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
                <label className="text-sm font-medium">Warpcast API key</label>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
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
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTestKey}
                  disabled={!apiKey.trim() || testingKey}
                >
                  {testingKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : keyValid === true ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : keyValid === false ? (
                    <XCircle className="h-4 w-4 text-red-500" />
                  ) : (
                    'Test'
                  )}
                </Button>
              </div>

              {keyError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {keyError}
                </p>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="saveApiKey"
                  checked={saveApiKey}
                  onChange={(e) => setSaveApiKey(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="saveApiKey" className="text-sm text-muted-foreground">
                  Save API key for next time
                </label>
              </div>

              {/* Instructions */}
              <div className="p-3 bg-muted rounded-lg text-sm space-y-2">
                <p className="font-medium">How to get your API key:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>
                    Go to{' '}
                    <a
                      href="https://warpcast.com/~/developers/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-foreground underline hover:no-underline"
                    >
                      warpcast.com/~/developers/api-keys
                    </a>
                  </li>
                  <li>Sign in with your Farcaster account</li>
                  <li>Create a new API key and paste it here</li>
                </ol>
                <p className="text-xs text-muted-foreground mt-2">
                  Your API key is stored locally in your browser and never sent to our servers.
                </p>
              </div>
            </div>

            {/* Message Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <label className="text-sm font-medium">Message</label>
              </div>

              <div className="relative">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                  placeholder={`Hey {{username}}! I noticed you hold some tokens...`}
                  className="w-full h-32 p-3 text-sm border rounded-lg resize-none bg-background"
                />
                <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
                  {message.length}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="text-muted-foreground">Variables:</span>
                {['{{username}}', '{{holdings}}', '{{ens}}', '{{wallet}}'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMessage((m) => m + v)}
                    className="px-2 py-0.5 bg-muted rounded hover:bg-muted/80 font-mono"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Continue button */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleContinueToPreview} disabled={!canContinue}>
                Continue
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Recipients</span>
                <span className="font-medium">{recipients.length.toLocaleString()} users</span>
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
              <p className="text-sm font-medium">Preview (for @{previewRecipient?.username}):</p>
              <div className="p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap border">
                {previewMessage || <span className="text-muted-foreground italic">Empty message</span>}
              </div>
              {previewRecipient && (
                <p className="text-xs text-muted-foreground">
                  Data for this user: username="{previewRecipient.username}"
                  {previewRecipient.holdings !== undefined && `, holdings=${previewRecipient.holdings.toLocaleString()}`}
                  {previewRecipient.ens && `, ens="${previewRecipient.ens}"`}
                  {!previewRecipient.holdings && !previewRecipient.ens && ' (no holdings/ENS data)'}
                </p>
              )}
            </div>

            {/* Warning */}
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
              <p className="font-medium flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                Keep this tab open
              </p>
              <p className="mt-1 text-amber-700 dark:text-amber-300">
                DMs are sent from your browser. Closing this tab will stop the process.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('configure')}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button onClick={handleStartSending}>
                <Play className="h-4 w-4 mr-1" />
                Start sending
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Sending */}
        {step === 'sending' && progress && (
          <div className="space-y-6">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>
                  Sending to <span className="font-medium">@{progress.currentUsername}</span>
                </span>
                <span>
                  {progress.sent + progress.failed} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${((progress.sent + progress.failed) / progress.total) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-green-600">{progress.sent}</div>
                <div className="text-xs text-muted-foreground">Sent</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">
                  {progress.total - progress.sent - progress.failed}
                </div>
                <div className="text-xs text-muted-foreground">Remaining</div>
              </div>
            </div>

            {/* Recent log entries */}
            <div className="max-h-32 overflow-y-auto border rounded-lg">
              {progress.log.slice(-5).reverse().map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-b-0"
                >
                  {entry.status === 'sent' ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                  )}
                  <span className="font-medium">@{entry.username}</span>
                  {entry.error && (
                    <span className="text-muted-foreground truncate">{entry.error}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Cancel button */}
            <div className="flex justify-center">
              <Button variant="outline" onClick={handleCancel}>
                <Square className="h-4 w-4 mr-1" />
                Stop sending
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 'complete' && progress && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="text-center space-y-2">
              {progress.status === 'cancelled' ? (
                <AlertCircle className="h-12 w-12 mx-auto text-amber-500" />
              ) : progress.failed === 0 ? (
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500" />
              ) : (
                <AlertCircle className="h-12 w-12 mx-auto text-amber-500" />
              )}
              <h3 className="text-xl font-semibold">
                {progress.status === 'cancelled'
                  ? 'Sending cancelled'
                  : progress.failed === 0
                    ? 'All DMs sent successfully'
                    : 'Sending complete with some failures'}
              </h3>
            </div>

            {/* Final stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
                <div className="text-3xl font-bold text-green-600">{progress.sent}</div>
                <div className="text-sm text-green-700 dark:text-green-400">Sent successfully</div>
              </div>
              <div className="text-center p-4 bg-red-50 dark:bg-red-950/30 rounded-lg">
                <div className="text-3xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-sm text-red-700 dark:text-red-400">Failed</div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 justify-center">
              <Button variant="outline" onClick={handleDownloadLog}>
                <Download className="h-4 w-4 mr-1" />
                Download log (CSV)
              </Button>
              {progress.failedRecipients.length > 0 && (
                <Button variant="outline" onClick={handleRetryFailed}>
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Retry {progress.failedRecipients.length} failed
                </Button>
              )}
            </div>

            {/* Close button */}
            <div className="flex justify-center">
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
