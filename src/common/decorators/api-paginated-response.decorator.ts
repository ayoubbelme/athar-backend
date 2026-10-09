import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginationMetaDto } from '../dto/paginated-response.dto';

/** Documents the standard `{ data: Model[], meta }` envelope in Swagger. */
export const ApiPaginatedResponse = <T extends Type<unknown>>(
  model: T,
): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ApiExtraModels(PaginationMetaDto, model),
    ApiOkResponse({
      schema: {
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );
