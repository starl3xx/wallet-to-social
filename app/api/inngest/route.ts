import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { walletLookup } from '@/inngest/functions/wallet-lookup';

// Serve Inngest functions from this API route
// Inngest will call this endpoint to execute functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [walletLookup],
});
