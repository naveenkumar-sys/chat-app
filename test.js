import { createClient } from '@insforge/sdk';

const client = createClient({ baseUrl: 'https://test.com', anonKey: '123' });
console.log(Object.keys(client.auth));
