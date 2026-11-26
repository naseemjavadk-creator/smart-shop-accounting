import "server-only";
import { q, q1 } from "./db";

export async function getTransaction(id: string) {
  const t = await q1<Record<string, unknown> & { created_by: string | null }>(
    `select t.*, t.txn_date::text txn_date, p.name party_name, p.kind party_kind, u.name created_by_name, v.name voided_by_name,
            a.name expense_account
       from transactions t left join parties p on p.id = t.party_id left join users u on u.id = t.created_by
       left join users v on v.id = t.voided_by left join accounts a on a.id = t.expense_account_id where t.id = $1`, [id]);
  if (!t) return null;
  const [lines, journal] = await Promise.all([
    q(`select tl.*, p.name product_name from transaction_lines tl left join products p on p.id = tl.product_id
        where tl.txn_id = $1 order by line_no`, [id]),
    q(`select je.id entry_id, je.entry_date::text, je.is_reversal, a.code, a.name account, jl.debit, jl.credit, p.name party
         from journal_entries je join journal_lines jl on jl.entry_id = je.id join accounts a on a.id = jl.account_id
         left join parties p on p.id = jl.party_id where je.txn_id = $1 order by je.id, jl.id`, [id]),
  ]);
  return { ...t, lines, journal };
}
