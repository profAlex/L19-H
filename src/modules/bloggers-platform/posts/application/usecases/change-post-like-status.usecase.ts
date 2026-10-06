import { Command, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PostsCommandRepository } from '../../infrastructure/posts.command-repository';
import { InjectModel } from '@nestjs/mongoose';
import { CreatePostLikeDto } from '../../dto/create-post-like.dto';
import {
    PostLike,
    PostLikeModelType,
} from '../../../likes/domain/post-like.entity';
import { PostLikesCommandRepository } from '../../../likes/infrastructure/post-likes.command-repostory';
import { DomainException } from '../../../../../core/exceptions/domain-exceptions';
import { DomainExceptionCode } from '../../../../../core/exceptions/domain-exception-codes';
import { PostLikesQueryRepository } from '../../../likes/infrastructure/query/post-likes.query-repository';
import { UsersExternalQueryRepository } from '../../../../user-accounts/infrastructure/external-query/users.external-query-repository';

// <void> - This type represents the command execution result
export class ChangePostLikeStatus extends Command<void> {
    constructor(public readonly dto: CreatePostLikeDto) {
        super();
    }
}

@CommandHandler(ChangePostLikeStatus)
export class ChangePostLikeStatusHandler implements ICommandHandler<ChangePostLikeStatus> {
    constructor(
        @InjectModel(PostLike.name) private PostLikeModel: PostLikeModelType,
        private postLikesCommandRepository: PostLikesCommandRepository,
        private postsCommandRepository: PostsCommandRepository,
    ) {}

    async execute({ dto }: ChangePostLikeStatus): Promise<void> {
        const { postId, userId, newLikeStatus } = dto;

        // console.warn('<---- postId to be found: ', postId);

        // проверяем что пост, которому пользователь меняет лайк-статус, существует
        const ifPostExists = await this.postsCommandRepository.SQLifPostExists(postId);
        if (!ifPostExists) {
            throw new DomainException({
                code: DomainExceptionCode.PostNotFound,
                message: `Post not found`,
            });
        }

        // console.warn('<---- ifPostExists value is: ', ifPostExists);

        // проверяем наличие реакции на пост
        const currentLikeStatus =
            await this.postLikesCommandRepository.SQLgetLikeByPostIdAndUserId(
                postId, userId
            );

        console.warn('<---- currentLikeStatus value is: ', currentLikeStatus);


        // НАЧАЛО ПРОВЕРОК
        // если прежней реакции не найдено и новая реакция не None, значит реакция добавляется впервые
        // и надо будет просто увеличить счетчик лайков или дислайков и добавить новую запись
        if ((currentLikeStatus === null || currentLikeStatus === 'None') && newLikeStatus !== 'None') {
            // создаем новый лайк в базе
            await this.postLikesCommandRepository.SQLupdateLikeStatus(postId, userId, newLikeStatus);

            // меняем счетчик
            if (newLikeStatus === 'Like') {
                await this.postsCommandRepository.SQLchangePostLikesCounter(postId, 1);
            }
            else if (newLikeStatus === 'Dislike') {
                await this.postsCommandRepository.SQLchangePostDislikesCounter(postId, 1);
            }
        }
        // если прежняя реакция найдена и она не равна вновь переданной
        else if (
            currentLikeStatus !== null &&
            currentLikeStatus !== newLikeStatus
        ) {
            // если новая реакция это None, тогда надо удалить запись лайка в репозитории лайков и сбросить реакцию в посте
            if (newLikeStatus === 'None') {
                // выставляем статус лайка (запись в базе) likeStatus в None, не удаляя физически
                await this.postLikesCommandRepository.SQLupdateLikeStatus(postId, userId, newLikeStatus);

                // делаем декремент счетчика лайка или дизлайка
                if(currentLikeStatus === 'Like'){
                    await this.postsCommandRepository.SQLchangePostLikesCounter(postId, -1);
                }
                else if (currentLikeStatus === 'Dislike') {
                    await this.postsCommandRepository.SQLchangePostDislikesCounter(postId, -1);
                }

            } else {
                // ветка на тот случай когда мы меняем(свитчим) реакцию на Like или Dislike (sentLike === "Like" или "Dislike")
                // меняем реакцию в коллекции лайков на новую
                await this.postLikesCommandRepository.SQLupdateLikeStatus(postId, userId, newLikeStatus);


                // меняем каунтер в посте
                if(newLikeStatus === 'Like') {
                    await this.postsCommandRepository.SQLswitchToLikePostCounter(postId);
                }
                else if(newLikeStatus === 'Dislike') {
                    await this.postsCommandRepository.SQLswitchToDislikePostCounter(postId);
                }
            }
        }
    }
}
