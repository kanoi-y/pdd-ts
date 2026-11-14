// Uses the Web Request/Response API accepted by Next.js App Router.
// Replace this fixed identity with your server-side authentication integration.
import { readOrder } from '../../../../node-api/src/orders.js';
export async function GET(request:Request):Promise<Response>{
  const userId=request.headers.get('x-example-user');
  if(!userId)return Response.json({error:'unauthenticated'},{status:401});
  const order=readOrder(userId,{id:'order-1',ownerId:'alice',total:120});
  return order?Response.json(order):Response.json({error:'not_found'},{status:404});
}
