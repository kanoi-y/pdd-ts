import type { Project } from '../requirements/project.js';
export function validateBoundaries(project:Project):string[] {
 const errors:string[]=[];
 const ids=project.config.boundaries.map(item=>item.id);
 if(new Set(ids).size!==ids.length) errors.push('Duplicate boundary ID');
 for(const requirement of project.requirements) for(const id of requirement.trustedBoundaries) if(!ids.includes(id)) errors.push(`Unregistered boundary: ${id}`);
 for(const boundary of project.config.boundaries) {
  if(!boundary.validatorFiles.length || !boundary.callerFiles.length) errors.push(`Missing runtime validator or caller: ${boundary.id}`);
  if(boundary.assumption && !project.config.approvedAssumptions.includes(boundary.assumption)) errors.push(`Unapproved boundary assumption: ${boundary.id}`);
  for(const id of boundary.testObligationIds) if(!project.obligations.some(item=>item.id===id && item.kind==='test') || !project.config.testTargets.some(item=>item.obligationId===id)) errors.push(`Missing boundary test: ${boundary.id}/${id}`);
 }
 return errors;
}
export function empiricalInputs(project:Project,obligationId:string):string[] {
 const target=project.config.testTargets.find(item=>item.obligationId===obligationId);
 if(!target) throw new Error('No empirical target registered');
 const boundaries=project.config.boundaries.filter(item=>item.testObligationIds.includes(obligationId));
 return [...new Set([...target.files,...target.inputs,...boundaries.flatMap(item=>[...item.callerFiles,...item.validatorFiles])])].sort();
}
