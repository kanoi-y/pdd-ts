import {defineContract,contractTest} from '@behavproof/vitest';
import {canAcceptEvidence} from '../../../src/verification/acceptance.js';
const acceptance=defineContract({
  "id": "PDD-EVIDENCE-ACCEPTANCE",
  "intent": "PDD accepts evidence only when completeness, scope, success, freshness, authenticity and approval all hold.",
  "risk": "basic",
  "cases": [
    {
      "id": "mask-00",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-01",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-02",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-03",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-04",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-05",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-06",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-07",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-08",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-09",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-10",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-11",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-12",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-13",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-14",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-15",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-16",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-17",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-18",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-19",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-20",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-21",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-22",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-23",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-24",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-25",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-26",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-27",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-28",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-29",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-30",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-31",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": false
      },
      "expected": false
    },
    {
      "id": "mask-32",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-33",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-34",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-35",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-36",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-37",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-38",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-39",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-40",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-41",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-42",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-43",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-44",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-45",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-46",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-47",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": false,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-48",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-49",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-50",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-51",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-52",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-53",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-54",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-55",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": false,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-56",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-57",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-58",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-59",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": false,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-60",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-61",
      "negative": true,
      "input": {
        "complete": true,
        "scoped": false,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-62",
      "negative": true,
      "input": {
        "complete": false,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": false
    },
    {
      "id": "mask-63",
      "negative": false,
      "input": {
        "complete": true,
        "scoped": true,
        "successful": true,
        "fresh": true,
        "authentic": true,
        "approved": true
      },
      "expected": true
    }
  ]
});
contractTest.each(acceptance,({expected})=>expected);
