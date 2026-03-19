import { createClient } from '@insforge/sdk';

const client = createClient({ baseUrl: 'https://78ufvvid.us-east.insforge.app', anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MTAzOTl9.7FwwIK7QvCpKtVEAcrJvUp3ZBhnL_oyjs-LI0QmPfKY' });

client.database.from('messages').select('*').limit(1).then(res => {
  console.log('Columns:', res.data?.[0] ? Object.keys(res.data[0]) : 'No data');
  console.log('Error:', res.error);
});
