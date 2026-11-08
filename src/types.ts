export type Allocation = { fundId: string; amountMinor: string };
export type Fund = {
  id: string;
  name: string;
  code: string;
  budgetMinor: string;
  usedMinor: string;
  periodStart: string;
  periodEnd: string;
  categories: string[];
  restrictions: string;
};
export type FundInput = Omit<Fund, "id" | "usedMinor">;
export type Box = { x: number; y: number; w: number; h: number; page: number };
export type Word = Box & { text: string };
export type Extraction = {
  engine: string;
  page: number;
  at: string;
  text: string;
  words: Word[];
  fields: { merchant?: string; expenseDate?: string; totalMinor?: string };
  sources: Partial<Record<"merchant" | "expenseDate" | "totalMinor", Box>>;
};
export type Expense = {
  id: string;
  documentId: string;
  filename: string;
  mime: string;
  hash: string;
  revision: number;
  merchant: string;
  claimant: string;
  purpose: string;
  expenseDate: string;
  category: string;
  totalMinor: string;
  eligibleMinor: string;
  reviewed: boolean;
  approved: boolean;
  approver: string;
  approvalReference: string;
  paidMinor: string;
  reconciledMinor: string;
  allocations: Allocation[];
  extraction: Extraction | null;
};
export type ReviewInput = Pick<
  Expense,
  | "id"
  | "merchant"
  | "claimant"
  | "purpose"
  | "expenseDate"
  | "category"
  | "totalMinor"
  | "eligibleMinor"
  | "reviewed"
  | "allocations"
> & { expectedRevision: number };
export type Payment = {
  id: string;
  expenseId: string;
  amountMinor: string;
  reference: string;
  date: string;
  reconciled: boolean;
};
export type Event = {
  id: number;
  targetId: string;
  action: string;
  detail: string;
  at: string;
};
export type Snapshot = {
  organization: string;
  operator: string;
  currency: string;
  storageEngine: string;
  funds: Fund[];
  expenses: Expense[];
  payments: Payment[];
  events: Event[];
};
export type Original = {
  bytes: number[] | Uint8Array;
  mime: string;
  filename: string;
};
export type ExportSpec =
  | { kind: "report"; profile: Profile }
  | { kind: "analytics"; start: string; end: string };
export type Report = {
  csv: string;
  rows: string[][];
  revisionToken: string;
  organization: string;
  spec: ExportSpec;
};
export type Profile = "funder" | "bookkeeper";
export const CATEGORIES = [
  "Workshop supplies",
  "Printing",
  "Travel",
  "Meals",
  "Equipment",
  "Other",
];
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export type RecordHistory = {
  reviews: { revision: number; payload: ReviewInput; at: string }[];
  extractions: { id: number; payload: Extraction; at: string }[];
};
