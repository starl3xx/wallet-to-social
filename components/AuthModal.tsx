'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mail, CheckCircle2, ArrowLeft } from 'lucide-react';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AuthState = 'email' | 'sent';

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<AuthState>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      // Delay reset to allow animation to complete
      const timer = setTimeout(() => {
        setState('email');
        setError(null);
        setLoading(false);
        setCooldown(0);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Cooldown timer for resend button
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleSendMagicLink = async () => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send sign-in link');
      }

      setState('sent');
      setCooldown(60); // 60 second cooldown before resend
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    await handleSendMagicLink();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleSendMagicLink();
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-md">
        {state === 'email' ? (
          <>
            <ModalHeader>
              <ModalTitle>Sign in</ModalTitle>
              <ModalDescription>
                Enter your email to receive a sign-in link. No password needed.
              </ModalDescription>
            </ModalHeader>

            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  autoFocus
                />
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>

              <Button
                className="w-full"
                onClick={handleSendMagicLink}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Send sign-in link
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <>
            <ModalHeader>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/10">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-500" />
              </div>
              <ModalTitle className="text-center">Check your email</ModalTitle>
              <ModalDescription className="text-center">
                We sent a sign-in link to <strong>{email}</strong>
              </ModalDescription>
            </ModalHeader>

            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground text-center">
                Click the link in the email to sign in. The link expires in 15 minutes.
              </p>

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleResend}
                  disabled={loading || cooldown > 0}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : cooldown > 0 ? (
                    `Resend in ${cooldown}s`
                  ) : (
                    'Resend link'
                  )}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setState('email');
                    setError(null);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Use a different email
                </Button>
              </div>

              {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
              )}
            </div>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
