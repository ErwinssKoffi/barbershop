export const RECONCILIATION_CHECKS = ['documentTotals','canonicalRecords','recordOwnership','cashSessionBalances','orphanCashMovements','invalidCashMovements'] as const
export type ReconciliationCheck = typeof RECONCILIATION_CHECKS[number]
export interface FinancialReconciliation {
 tenantId:string
 checkedAt:string
 status:'balanced'|'discrepancies'|'incomplete'
 refundsAvailable:boolean
 documentsChecked:number
 cashSessionsChecked:number
 checks:Record<ReconciliationCheck,number>
 readOnly:true
}
/** Shared fail-closed response validation. Counts only, never financial payloads or personal data. */
export function validateFinancialReconciliation(value:unknown,tenantId:string):FinancialReconciliation {
 if(!value || typeof value!=='object') throw new Error('Rapprochement serveur incohérent.')
 const report=value as FinancialReconciliation
 const count=(n:unknown) => typeof n==='number' && Number.isSafeInteger(n) && n>=0
 if(report.tenantId!==tenantId || report.readOnly!==true || typeof report.refundsAvailable!=='boolean' || typeof report.checkedAt!=='string' || !Number.isFinite(Date.parse(report.checkedAt)) || !count(report.documentsChecked) || !count(report.cashSessionsChecked) || !report.checks || RECONCILIATION_CHECKS.some((key) => !count(report.checks[key]))) throw new Error('Rapprochement serveur incohérent.')
 const discrepancies=RECONCILIATION_CHECKS.some((key) => report.checks[key]>0)
 const expected=discrepancies ? 'discrepancies' : report.refundsAvailable ? 'balanced' : 'incomplete'
 if(report.status!==expected) throw new Error('Rapprochement serveur incohérent.')
 return report
}
