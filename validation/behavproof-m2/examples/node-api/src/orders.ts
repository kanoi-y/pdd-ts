export interface Order { id:string; ownerId:string; total:number }
/** API application service: a caller may read only their own order. */
export function readOrder(userId:string,order:Order):Order|null {
  return userId===order.ownerId?order:null;
}
