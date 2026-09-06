import { Inject } from '@nestjs/common';

import { KYSELY } from './constants';

export const InjectKysely = () => Inject(KYSELY);
