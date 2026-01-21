import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getUserAccess } from '@/lib/access';
import { getContractHolders, type SupportedChain } from '@/lib/contract-holders';
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

  try {
    const body: ContractHoldersRequest = await request.json();
    const { contractAddress, chain } = body;

    // Validate required fields
    if (!contractAddress) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    if (!chain || !['ethereum', 'base'].includes(chain)) {
      return NextResponse.json(
        { error: 'Chain must be "ethereum" or "base"' },
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

    // Check user access - must be unlimited tier
    const access = await getUserAccess(session.user.email);

    if (access.tier !== 'unlimited') {
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
          error: 'Contract import is only available for Unlimited tier users',
          upgradeRequired: true,
          tier: access.tier,
        },
        { status: 403 }
      );
    }

    // Check required API keys
    const alchemyKey = process.env.ALCHEMY_KEY;
    const moralisKey = process.env.MORALIS_API_KEY;

    if (!alchemyKey) {
      console.error('ALCHEMY_KEY not configured for contract holder lookups');
      return NextResponse.json(
        { error: 'NFT holder lookup service not configured' },
        { status: 503 }
      );
    }

    if (!moralisKey) {
      console.error('MORALIS_API_KEY not configured for ERC-20 holder lookups');
      return NextResponse.json(
        { error: 'Token holder lookup service not configured' },
        { status: 503 }
      );
    }

    // Fetch contract holders
    const result = await getContractHolders(contractAddress, chain);

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
      },
    });

    return NextResponse.json({
      wallets: result.wallets,
      tokenName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
      contractType: result.contractType,
      totalHolders: result.totalHolders,
      truncated: result.truncated,
      chain: result.chain,
    });
  } catch (error) {
    console.error('Contract holders error:', error);

    // Map error codes to user-friendly messages
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

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
        message: 'Too many requests, please try again',
        status: 429,
      },
    };

    const mappedError = errorMap[errorMessage];
    if (mappedError) {
      return NextResponse.json(
        { error: mappedError.message },
        { status: mappedError.status }
      );
    }

    // Generic error
    return NextResponse.json(
      { error: 'Failed to fetch contract holders. Please try again.' },
      { status: 500 }
    );
  }
}
