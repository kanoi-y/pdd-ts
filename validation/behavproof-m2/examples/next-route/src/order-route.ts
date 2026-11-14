export type Order={id:string;ownerId:string;total:number};
export type Session={userId:string};
export type RouteDependencies={session:(request:Request)=>Promise<Session|null>;findOrder:(id:string)=>Promise<Order|undefined>};
/** The application supplies its trusted session resolver and order store. */
export function createOrderGetHandler(dependencies:RouteDependencies){
 return async function GET(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{
  const session=await dependencies.session(request);
  if(!session)return Response.json({error:'unauthorized'},{status:401});
  const {id}=await context.params;
  const order=await dependencies.findOrder(id);
  if(!order)return Response.json({error:'not_found'},{status:404});
  if(order.ownerId!==session.userId)return Response.json({error:'forbidden'},{status:403});
  return Response.json({id:order.id,total:order.total});
 };
}
