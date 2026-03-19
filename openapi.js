fetch('https://78ufvvid.us-east.insforge.app/api/database/records/', { headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3OC0xMjM0LTU2NzgtOTBhYi1jZGVmMTIzNDU2NzgiLCJlbWFpbCI6ImFub25AaW5zZm9yZ2UuY29tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MTAzOTl9.7FwwIK7QvCpKtVEAcrJvUp3ZBhnL_oyjs-LI0QmPfKY' } })
  .then(res => res.json())
  .then(spec => {
    console.log('Columns in messages:', Object.keys(spec.definitions.messages.properties));
  })
  .catch(e => console.error(e.message));
