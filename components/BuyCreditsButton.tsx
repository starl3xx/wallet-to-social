'use client';

import { Button } from '@/components/ui/button';
import { useUpgradeModal } from '@/components/UpgradeModalProvider';

/**
 * The one client island on /pricing: the page is otherwise server-rendered,
 * and the buy-credits modal is the checkout, so the page does not build a
 * second one. The trigger names this gate for the analytics.
 */
export function BuyCreditsButton({ children }: { children: React.ReactNode }) {
  const upgradeModal = useUpgradeModal();
  return (
    <Button onClick={() => upgradeModal.open(undefined, 'pricing-page')}>
      {children}
    </Button>
  );
}
