export interface PostRecord {
  id: string;
  title: string;
  body: string;
  ownerId: string;
  archived: boolean;
  published: boolean;
}

export interface Invoice {
  id: string;
  amount: number;
  status: 'paid' | 'unpaid';
  date: string;
}
