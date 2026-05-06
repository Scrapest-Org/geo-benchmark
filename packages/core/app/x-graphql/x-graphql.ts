import type GuestTokenManager from "../guest-token-manager";
import {
  QUERY_IDS,
  USER_PROFILE_FEATURES,
  USER_PROFILE_FIELD_TOGGLES,
  TWEET_FEATURES,
  TWEET_FIELD_TOGGLES,
  COMMUNITY_FEATURES,
  USER_TWEETS_FEATURES,
  USER_TWEETS_TOGGLE,
} from "../../constants/graphql-constants";
import { XGQLInternal } from "./internal";

export class XGQL extends XGQLInternal {
  constructor(guestTokenManager: GuestTokenManager) {
    super(guestTokenManager);
  }

  async fetchFollowing(username: string, authHeaders: Record<string, any>) {
    const variables = JSON.stringify({
      screen_name: username,
    });

    const params = new URLSearchParams({ variables });
    const path = `/graphql/${QUERY_IDS.ProfileSpotlightsQuery}/ProfileSpotlightsQuery`;
    const headers = await this.buildAuthHeaders("GET", path, authHeaders);

    const json = await this.proxyQuery<GraphQLProfileSpotlightsResponse>(
      "ProfileSpotlightsQuery",
      params,
      headers,
    );

    const r = json?.data?.user_result_by_screen_name?.result;
    if (!r) {
      throw new Error(`"${username}" not found on X (suspended or deleted?)`);
    }

    return {
      id: r.rest_id,
      name: r.core?.name ?? "",
      username: r.core?.screen_name ?? "",
      protected: r.privacy?.protected ?? false,
      following: r.relationship_perspectives?.following ?? false,
      isBlocking: r.relationship_perspectives?.blocking ?? false,
      isBlockedBy: r.relationship_perspectives?.blocked_by ?? false,
    };
  }

  async fetchUserProfile(screenName: string): Promise<UserProfileData> {
    const variables = JSON.stringify({
      screen_name: screenName,
      withSafetyModeUserFields: true,
    });
    const features = JSON.stringify(USER_PROFILE_FEATURES);
    const fieldToggles = JSON.stringify(USER_PROFILE_FIELD_TOGGLES);

    const params = new URLSearchParams({ variables, features, fieldToggles });
    const json = await this.query<GraphQLUserResponse>(
      "UserByScreenName",
      params,
    );
    const err = `The username "${screenName}" was not found on X`;
    if (!("user" in json.data)) throw new Error(err);
    const r = json?.data?.user?.result;
    if (!r) throw new Error(`"${screenName}" did not return a result on X`);

    return {
      id: r.rest_id,
      name: r.core?.name ?? "",
      screen_name: r.core?.screen_name ?? "",
      description: r.legacy?.description ?? "",
      location: r.location?.location ?? "",
      url: r.legacy?.entities?.url?.urls?.[0]?.expanded_url,
      created_at: r.core?.created_at ?? "",
      followers_count: r.legacy?.followers_count ?? 0,
      friends_count: r.legacy?.friends_count ?? 0,
      statuses_count: r.legacy?.statuses_count ?? 0,
      favourites_count: r.legacy?.favourites_count ?? 0,
      listed_count: r.legacy?.listed_count ?? 0,
      media_count: r.legacy?.media_count ?? 0,
      verified: r.verification?.verified ?? false,
      is_blue_verified: r.is_blue_verified ?? false,
      profile_image_url: r.avatar?.image_url ?? "",
      profile_banner_url: r.legacy?.profile_banner_url,
      protected: r.privacy?.protected ?? false,
    };
  }

  async fetchXPost(postId: string): Promise<ResolvedXPost> {
    const variables = JSON.stringify({
      tweetId: postId,
      withCommunity: true,
      includePromotedContent: false,
      withVoice: false,
    });
    const features = JSON.stringify(TWEET_FEATURES);
    const fieldToggles = JSON.stringify(TWEET_FIELD_TOGGLES);

    const params = new URLSearchParams({ variables, features, fieldToggles });
    const json = await this.query<GraphQLXPostResponse>(
      "TweetResultByRestId",
      params,
    );
    const err = `The post "${postId}" was not found on X`;
    if (!("tweetResult" in json.data)) throw new Error(err);
    const raw = json?.data?.tweetResult?.result;
    if (!raw) throw new Error(err);
    return this.resolveXPost(raw);
  }

  async fetchCommunity(communityId: string): Promise<CommunityData> {
    const variables = JSON.stringify({
      communityId,
      withDmMuting: false,
      withSafetyModeUserFields: false,
    });
    const features = JSON.stringify(COMMUNITY_FEATURES);

    const params = new URLSearchParams({ variables, features });
    const json = await this.query<GraphQLCommunityResponse>(
      "CommunityQuery",
      params,
    );
    const c = json?.data?.communityResults?.result;
    if (!c) {
      throw new Error(`Community "${communityId}" not found on X`);
    }

    if (c.__typename === "CommunityUnavailable") {
      throw new Error(`Community unavailable: ${c.reason ?? "unknown"}`);
    }

    const creator = c.creator_results?.result;
    return {
      id: c.rest_id,
      name: c.name,
      description: c.description,
      created_at: c.created_at,
      member_count: c.member_count,
      join_policy: c.join_policy,
      is_nsfw: c.is_nsfw,
      topic: c.primary_community_topic?.topic_name,
      banner_url:
        c.custom_banner_media?.media_info.original_img_url ??
        c.default_banner_media?.media_info.original_img_url,
      creator: {
        id: creator?.rest_id ?? creator?.id ?? "",
        name: creator?.core?.name ?? "",
        screen_name: creator?.core?.screen_name ?? "",
        profile_image_url: creator?.avatar?.image_url ?? "",
      },
      rules: (c.rules ?? []).map((r) => ({
        id: r.rest_id,
        name: r.name,
        description: r.description,
      })),
      members_facepile: (c.members_facepile_results ?? []).map((m) => ({
        id: m.result.rest_id ?? m.result.id ?? "",
        name: m.result.core?.name ?? "",
        screen_name: m.result.core?.screen_name ?? "",
        profile_image_url: m.result.avatar?.image_url ?? "",
      })),
    };
  }

  async fetchXUserPosts(
    uid: string,
    cursor?: string,
    skipPinned = false,
    headers?: Record<string, string>,
  ) {
    const variables = JSON.stringify({
      userId: uid,
      count: 20,
      includePromotedContent: true,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      ...(cursor ? { cursor } : {}),
    });
    const features = JSON.stringify(USER_TWEETS_FEATURES);
    const fieldToggles = JSON.stringify(USER_TWEETS_TOGGLE);

    const params = new URLSearchParams({ variables, features, fieldToggles });
    const path = `/graphql/${QUERY_IDS.UserTweets}/UserTweets`;

    const customHeaders = await this.buildAuthHeaders("GET", path, headers!);

    const { data } = await this.proxyQuery<GraphQLXUserPostsResponse>(
      "UserTweets",
      params,
      customHeaders,
    );
    const raw = data?.user?.result?.timeline?.timeline?.instructions || [];
    const entries: Entry[] = raw
      .filter(
        (i) =>
          i.type === "TimelineAddEntries" ||
          (!skipPinned && i.type === "TimelinePinEntry"),
      )
      .flatMap((i: any) => i.entries || [i.entry]);

    const posts = [];
    let nextCursor: string | undefined;

    for (const entry of entries) {
      const content = entry.content;

      if (content?.itemContent?.tweet_results?.result) {
        posts.push(this.resolveXPost(content.itemContent.tweet_results.result));

        continue;
      }

      if (content?.cursorType === "Bottom") {
        nextCursor = content.value;
      }
    }

    return { posts, nextCursor };
  }
}
