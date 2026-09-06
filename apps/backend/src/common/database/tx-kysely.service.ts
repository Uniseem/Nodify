import { Kysely } from 'kysely';
import { DB } from 'prisma/generated/types';

import { Injectable } from '@nestjs/common';

import { InjectKysely } from './kysely-prisma';

@Injectable()
export class TxKyselyService {
    constructor(@InjectKysely() public readonly kysely: Kysely<DB>) {}
}
