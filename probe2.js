import { createClient } from '@insforge/sdk';
import fs from 'fs';

const insforge = createClient({ baseUrl: 'https://78ufvvid.us-east.insforge.app', anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MTAzOTl9.7FwwIK7QvCpKtVEAcrJvUp3ZBhnL_oyjs-LI0QmPfKY' });

async function probe() {
  const { error } = await insforge.database.from('messages').insert([{}]);
  fs.writeFileSync('probe.json', JSON.stringify(error, null, 2));
}

probe();
