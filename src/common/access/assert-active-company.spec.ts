import { ForbiddenException } from '@nestjs/common';
import { assertActiveCompany } from './assert-active-company.js';

const ACTIVE = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';

describe('assertActiveCompany', () => {
  it('lets through a request that points at the active company', () => {
    expect(() => assertActiveCompany(ACTIVE, ACTIVE)).not.toThrow();
  });

  it('does not care about upper or lower case in the id', () => {
    expect(() => assertActiveCompany(ACTIVE, ACTIVE.toUpperCase())).not.toThrow();
  });

  it('lets through a request that does not name a company', () => {
    expect(() => assertActiveCompany(ACTIVE, undefined)).not.toThrow();
    expect(() => assertActiveCompany(ACTIVE, null)).not.toThrow();
  });

  it('rejects a request that points at another company', () => {
    expect(() => assertActiveCompany(ACTIVE, OTHER)).toThrow(ForbiddenException);
  });
});
