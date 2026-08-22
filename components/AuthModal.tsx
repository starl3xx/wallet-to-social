'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CircleNotch as Loader2,
  Envelope as Mail,
  CheckCircle as CheckCircle2,
  ArrowLeft,
} from '@phosphor-icons/react';

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
                {/* A visible label, the same one Buy credits uses, so the two
                    email dialogs match and the field has a name. The
                    placeholder alone named nothing for a screen reader. */}
                <label htmlFor="sign-in-email" className="text-sm font-medium">
                  Email address
                </label>
                <Input
                  id="sign-in-email"
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

              {/* The action row in ModalFooter's one layout: natural width at
                  the right on a desktop, full width on a phone. It was a
                  full-width button at every size, one of four row layouts
                  the six dialogs had between them. */}
              <ModalFooter>
                <Button onClick={handleSendMagicLink} disabled={loading}>
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
              </ModalFooter>
            </div>
          </>
        ) : (
          <>
            <ModalHeader>
              {/* A display moment, so the icon is `h-10 w-10` duotone with no
                  disc: it was a 24px icon in a 48px tinted disc, two sizes the
                  icon scale does not have. Green, because the link went: a
                  delivered sign-in link is a measured outcome, and violet would
                  have called it an affordance. The header's `space-y` owns the
                  gap beneath it. */}
              <CheckCircle2
                className="mx-auto h-10 w-10 text-attested"
                weight="duotone"
              />
              <ModalTitle className="text-center">Check your email</ModalTitle>
              <ModalDescription className="text-center">
                We sent a sign-in link to <strong>{email}</strong>
              </ModalDescription>
            </ModalHeader>

            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground text-center">
                Click the link in the email to sign in. The link expires in 15
                minutes.
              </p>

              {/* Neither is the primary (the primary action is in the
                  person's inbox), so no filled button. Resend is the one they
                  are likelier to want, so it sits last in the DOM: right on a
                  desktop, top of the stack on a phone. `tabular-nums` because
                  the countdown ticks once a second and proportional digits
                  would make the label wobble. */}
              <ModalFooter>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setState('email');
                    setError(null);
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Use a different email
                </Button>
                <Button
                  variant="outline"
                  className="tabular-nums"
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
              </ModalFooter>

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
