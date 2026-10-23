import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Term } from './db';

/** All terms for a language, keyed by normalized term. */
export function useTermMap(lang: string): Map<string, Term> | undefined {
  return useLiveQuery(async () => {
    const terms = await db.terms.where({ lang }).toArray();
    return new Map(terms.map((t) => [t.term, t]));
  }, [lang]);
}
