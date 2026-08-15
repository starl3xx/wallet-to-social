import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserAccess } from '@/lib/access';
import {
  getContractHolders,
  CHAIN_LABELS,
  SUPPORTED_CHAINS,
  type SupportedChain,
} from '@/lib/contract-holders';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';

// Longer timeout for potentially slow API calls
export const maxDuration = 60;

interface ContractHoldersRequest {
  contractAddress: string;
  chain: SupportedChain;
}

export async function POST(request: NextRequest) {
  // Require authenticated session
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const session = await validateSession(sessionToken);
  if (!session.user) {
    return NextResponse.json(
      { error: 'Invalid or expired session' },
      { status: 401 }
    );
  }

  // Declared outside the try so the catch block can name the chain in errors.
  let chain: SupportedChain | undefined;

  try {
    const body: ContractHoldersRequest = await request.json();
    const { contractAddress } = body;
    chain = body.chain;

    // Validate required fields
    if (!contractAddress) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    if (!chain || !SUPPORTED_CHAINS.includes(chain)) {
      return NextResponse.json(
        { error: `Chain must be one of: ${SUPPORTED_CHAINS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate address format (basic check)
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    if (!addressRegex.test(contractAddress)) {
      return NextResponse.json(
        { error: 'Please enter a valid Ethereum address' },
        { status: 400 }
      );
    }

    // Contract import is the strongest feature in the product and used to sit
    // behind the top tier, where almost nobody reached it (3 successful imports
    // ever). It is now the headline reason to buy Pro.
    const access = await getUserAccess(session.user.email);

    if (access.tier !== 'pro' && access.tier !== 'unlimited') {
      trackEvent('contract_import_blocked', {
        userId: session.user.email,
        metadata: {
          tier: access.tier,
          contractAddress,
          chain,
        },
      });

      return NextResponse.json(
        {
          error: 'Contract import is available on Pro and Unlimited',
          upgradeRequired: true,
          tier: access.tier,
        },
        { status: 403 }
      );
    }

    // Alchemy backs NFT holder lookups on every supported chain, so it is the one
    // hard requirement. Moralis is only needed for ERC-20 contracts, so it is not
    // gated here — getERC20Holders raises its own error if a token lookup needs it
    // and the key is absent. Gating upfront would block NFT imports on a chain
    // where Moralis has no coverage at all (e.g. Robinhood).
    const alchemyKey = process.env.ALCHEMY_KEY;

    if (!alchemyKey) {
      console.error('ALCHEMY_KEY not configured for contract holder lookups');
      return NextResponse.json(
        { error: 'NFT holder lookup service not configured' },
        { status: 503 }
      );
    }

    // Fetch contract holders
    // Cap the import at what this account can actually look up, so the feature
    // cannot hand a Pro user a list that trips the upgrade wall on Start Lookup.
    const result = await getContractHolders(
      contractAddress,
      chain,
      Number.isFinite(access.walletLimit) ? access.walletLimit : undefined
    );

    // Track successful import
    trackEvent('contract_import_success', {
      userId: session.user.email,
      metadata: {
        contractAddress,
        chain,
        tokenName: result.tokenName,
        tokenSymbol: result.tokenSymbol,
        contractType: result.contractType,
        totalHolders: result.totalHolders,
        holdersReturned: result.wallets.length,
        truncated: result.truncated,
        appliedLimit: result.appliedLimit,
      },
    });

    return NextResponse.json({
      wallets: result.wallets,
      tokenName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
      contractType: result.contractType,
      totalHolders: result.totalHolders,
      truncated: result.truncated,
      appliedLimit: result.appliedLimit,
      chain: result.chain,
    });
  } catch (error) {
    console.error('Contract holders error:', error);

    // Map error codes to user-friendly messages
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const chainLabel = chain ? (CHAIN_LABELS[chain] ?? chain) : 'this chain';

    const errorMap: Record<string, { message: string; status: number }> = {
      NOT_A_CONTRACT: {
        message: 'This address is not a smart contract',
        status: 400,
      },
      INVALID_ADDRESS: {
        message: 'Please enter a valid Ethereum address',
        status: 400,
      },
      NO_HOLDERS: {
        message: 'This contract has no token holders',
        status: 404,
      },
      RATE_LIMIT: {
        message: 'Too many requests, please try again in a moment',
        status: 429,
      },
      DAILY_ALLOWANCE_SPENT: {
        // Deliberately not "try again shortly". The allowance resets on a daily
        // boundary, so telling someone to retry sends them into a loop that
        // cannot succeed. No provider named, per the UI rule.
        message:
          'Token (ERC-20) holder import has reached its daily limit and will be available again tomorrow. NFT collections are unaffected, and an upload or a pasted list works now.',
        status: 503,
      },
      MORALIS_NOT_CONFIGURED: {
        message: 'Token holder lookup service not configured',
        status: 503,
      },
      UNSUPPORTED_CHAIN: {
        message: `Unsupported network. Choose one of: ${SUPPORTED_CHAINS.map((c) => CHAIN_LABELS[c]).join(', ')}`,
        status: 400,
      },
      CHAIN_NO_NFT_SUPPORT: {
        message: `NFT holder lookups are not available on ${chainLabel}`,
        status: 400,
      },
      CHAIN_NFT_NOT_ENABLED: {
        // No provider names in UI copy (see CLAUDE.md), and this is our
        // configuration to fix, not something the customer did or can change.
        message: `NFT holder import on ${chainLabel} is temporarily unavailable. Token (ERC-20) import works on this chain in the meantime.`,
        status: 503,
      },
      CHAIN_NO_ERC20_SUPPORT: {
        message: `Token (ERC-20) holder lookups are not available on ${chainLabel}. NFT collections on this chain are supported.`,
        status: 400,
      },
    };

    const mappedError = errorMap[errorMessage];
    if (mappedError) {
      return NextResponse.json(
        { error: mappedError.message },
        { status: mappedError.status }
      );
    }

    // Check for API-specific errors and provide helpful messages
    if (errorMessage.includes('Moralis API error')) {
      console.error('Moralis API failed:', errorMessage);
      return NextResponse.json(
        { error: 'Token holder service temporarily unavailable. Please try again.' },
        { status: 503 }
      );
    }

    if (errorMessage.includes('Alchemy API error')) {
      console.error('Alchemy API failed:', errorMessage);
      return NextResponse.json(
        { error: 'NFT holder service temporarily unavailable. Please try again.' },
        { status: 503 }
      );
    }

    if (errorMessage.includes('timed out')) {
      return NextResponse.json(
        { error: 'Request timed out. The contract may have too many holders.' },
        { status: 504 }
      );
    }

    if (errorMessage.includes('403 Forbidden') || errorMessage.includes('not enabled')) {
      console.error('Network not enabled in API provider:', errorMessage);
      return NextResponse.json(
        { error: 'This network is not currently supported. Please try Ethereum.' },
        { status: 503 }
      );
    }

    // Log the full error for debugging
    console.error('Unhandled contract holders error:', {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Generic error with the actual message in dev
    return NextResponse.json(
      { error: 'Failed to fetch contract holders. Please try again.' },
      { status: 500 }
    );
  }
}
