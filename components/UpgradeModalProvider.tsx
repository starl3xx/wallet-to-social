'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/components/AuthProvider';

// Lazy, as it was on the homepage: the modal is a checkout surface, and most
// page views never open it.
const UpgradeModal = dynamic(() =>
  import('@/components/UpgradeModal').then((m) => ({ default: m.UpgradeModal }))
);

interface UpgradeModalContextValue {
  /**
   * Open the buy-credits modal. `walletCount` is the list the person is
   * holding, when there is one: the modal uses it to mark the smallest pack
   * whose headroom covers the file, and to log the open as a limit hit rather
   * than a feature gate.
   */
  open: (walletCount?: number) => void;
  close: () => void;
}

const UpgradeModalContext = createContext<UpgradeModalContextValue | null>(
  null
);

/**
 * The buy-credits modal, mounted once for every page.
 *
 * It lived in app/page.tsx as local state, so "Buy credits" in the header could
 * only exist on the homepage: the shell now renders the account cluster on
 * every route, and a button that opens a modal it cannot reach is worse than no
 * button. The modal moves up to where the header is, which is the layout, and
 * the pages that open it (the homepage from nine call sites, the API keys
 * modal from one) ask this context instead of owning a copy.
 *
 * Mounted inside AuthProvider, because the modal reports the current tier.
 */
export function UpgradeModalProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [walletCount, setWalletCount] = useState<number | undefined>();
  // The chunk is not fetched until the first open. Once it has been, the
  // modal stays mounted so Radix can run its exit animation on close.
  const [everOpened, setEverOpened] = useState(false);

  const open = useCallback((count?: number) => {
    setWalletCount(count);
    setEverOpened(true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <UpgradeModalContext.Provider value={value}>
      {children}
      {everOpened && (
        <UpgradeModal
          open={isOpen}
          onOpenChange={setIsOpen}
          currentTier={user?.tier ?? 'free'}
          walletCount={walletCount}
        />
      )}
    </UpgradeModalContext.Provider>
  );
}

export function useUpgradeModal(): UpgradeModalContextValue {
  const context = useContext(UpgradeModalContext);
  if (!context) {
    throw new Error(
      'useUpgradeModal must be used within an UpgradeModalProvider'
    );
  }
  return context;
}
