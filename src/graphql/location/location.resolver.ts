import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { RecordStatus } from '../../common/enums/record-status.enum.js';
import { CreateLocationInput } from './dto/create-location.input.js';
import { LocationObjectType } from './dto/location.object-type.js';
import { UpdateLocationInput } from './dto/update-location.input.js';
import { LocationService } from './location.service.js';

@Resolver(() => LocationObjectType)
export class LocationResolver {
  constructor(private readonly locationService: LocationService) {}

  @Query(() => [LocationObjectType])
  locations(
    @Args('companyId', { type: () => ID, nullable: true }) companyId?: string,
    @Args('status', { type: () => RecordStatus, nullable: true }) status?: RecordStatus,
  ) {
    return this.locationService.findAll(companyId, status);
  }

  @Query(() => LocationObjectType)
  location(@Args('id', { type: () => ID }) id: string) {
    return this.locationService.findOne(id);
  }

  @Mutation(() => LocationObjectType)
  createLocation(@Args('input') input: CreateLocationInput) {
    return this.locationService.create(input);
  }

  @Mutation(() => LocationObjectType)
  updateLocation(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateLocationInput,
  ) {
    return this.locationService.update(id, input);
  }

  @Mutation(() => LocationObjectType)
  deactivateLocation(@Args('id', { type: () => ID }) id: string) {
    return this.locationService.deactivate(id);
  }
}
