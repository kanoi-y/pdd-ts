# Next App Router compatible contract example

The handler factory uses native Request/Response and Promise-based route params, matching the [Next Route Handler interface](https://nextjs.org/docs/app/api-reference/file-conventions/route). It adds no Next dependency to the SDK. In an application route module, export `GET = createOrderGetHandler({session, findOrder})` using that application's trusted session and database resolvers.

From the built SDK workspace:

```sh
node node_modules/vitest/vitest.mjs run --config examples/next-route/vitest.config.mjs
```

Four public-SDK contract cases exercise the actual handler: no session401, other owner403, owner200, missing order404. The no-session case also rejects any order-store access. Resolver inputs are controlled test fixtures. A Next server/build, session implementation and database are outside this example's verification.

Critical audit keeps unverified human approval, producer authority, scoped production observations, mutation sensitivity, coverage/mutation and external protection unknown. Comparisons alone cannot fill those obligations. Native Response/factory targets need a suitable independently selected HTTP observation/fault protocol; the narrow JSON-function probe is not automatically applied here.
