import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Lo que el navegador entrega al suscribirse: la dirección del servicio de push y los secretos con que se
// cifran los avisos. El límite del endpoint lo revisa también push-endpoint.ts.
@InputType()
export class RegisterPushSubscriptionInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  endpoint: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  userAgent?: string;
}

// Lo público de la configuración: la llave con la que el navegador se suscribe. `null` si el aviso del
// sistema está apagado en este servidor.
@ObjectType('PushConfig')
export class PushConfigObjectType {
  @Field(() => String, { nullable: true })
  publicKey: string | null;
}
