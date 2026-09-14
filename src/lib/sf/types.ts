// The subset of Salesforce REST response shapes this app reads.

export interface SfQueryResult<T> {
  totalSize: number;
  done: boolean;
  nextRecordsUrl?: string;
  records: T[];
}

export interface SfPicklistValue {
  value: string;
  label: string;
  active: boolean;
  defaultValue: boolean;
}

export interface SfField {
  name: string;
  label: string;
  type: string;
  custom: boolean;
  nillable: boolean;
  length: number;
  calculated: boolean;
  externalId: boolean;
  unique: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  picklistValues: SfPicklistValue[];
}

export interface SfRecordTypeInfo {
  recordTypeId: string;
  name: string;
  developerName: string;
  active: boolean;
  available: boolean;
  master: boolean;
}

export interface SfChildRelationship {
  childSObject: string;
  field: string;
  relationshipName: string | null;
}

export interface SfDescribe {
  name: string;
  label: string;
  custom: boolean;
  queryable: boolean;
  fields: SfField[];
  recordTypeInfos: SfRecordTypeInfo[];
  childRelationships: SfChildRelationship[];
}

export interface SfGlobalDescribe {
  sobjects: { name: string; label: string; custom: boolean; queryable: boolean }[];
}

export type SfLimits = Record<string, { Max: number; Remaining: number }>;
