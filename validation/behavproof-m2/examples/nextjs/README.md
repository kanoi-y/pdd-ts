# Next.js equivalent

`app/api/orders/route.ts` is a Web Request/Response route that can be copied into a Next.js App Router project. It calls the same production service as the Node example. The `x-example-user` header is a deterministic fixture identity; replace it with your server-side authentication provider before deployment.

Test the exported GET directly in Vitest and register contracts with the helper. Do not import Next.js build configuration into `behavproof check`. This example does not install or claim a full Next.js application build; the public-flow test exercises the route boundary and 401/404/200 behavior.
