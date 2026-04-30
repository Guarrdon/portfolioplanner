import { useQuery } from '@tanstack/react-query';
import { fetchActualPositions } from '../services/schwab';
import { LAST_ACCOUNT_KEY } from '../components/schwab/AccountPicker';

// Resolves the account currently selected by the top-right account button.
// Returns the matching account row from the cached `schwab-accounts-landing`
// query, or null when "All Accounts" is active or the remembered hash no
// longer maps to a known account. All consumers share the same React Query
// key so we don't trigger extra network calls.
export function useSelectedAccount() {
  const remembered =
    typeof window !== 'undefined' ? localStorage.getItem(LAST_ACCOUNT_KEY) : null;
  const { data } = useQuery({
    queryKey: ['schwab-accounts-landing'],
    queryFn: () => fetchActualPositions(),
  });
  const accounts = data?.accounts || [];
  return remembered ? accounts.find((a) => a.account_hash === remembered) || null : null;
}

export function useSelectedAccountHash() {
  const selected = useSelectedAccount();
  return selected?.account_hash || null;
}
