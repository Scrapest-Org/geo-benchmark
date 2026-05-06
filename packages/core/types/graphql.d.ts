// ── Raw GraphQL response wrappers ──

interface GraphQLUserResponse {
  data: {
    user: {
      result: RawUserResult;
    };
  };
}

interface GraphQLXPostResponse {
  data: {
    tweetResult: {
      result?: RawXPostResult;
    };
  };
}

interface GraphQLCommunityResponse {
  data: {
    communityResults: {
      result: RawCommunity;
    };
  };
}

interface GraphQLProfileSpotlightsResponse {
  data: {
    user_result_by_screen_name: {
      id: string;
      result?: ProfileSpotlightsQuery;
    };
  };
}

interface GraphQLXUserPostsResponse {
  data: {
    user: {
      result: {
        timeline: {
          timeline: {
            instructions: Array<I1 | I2 | I3>;
          };
        };
      };
    };
  };
}

type Entry = {
  entryId: string; // starts with tweet- is a post;
  sortIndex: string;
  content: {
    itemContent?: {
      tweet_results: {
        result: RawXPostResult;
      };
    };
    cursorType?: "Bottom" | "Top";
    value?: string;
  };
};

type I1 = {
  type: "TimelineClearCache";
};
type I2 = {
  type: "TimelinePinEntry";
  entry: Entry;
};
type I3 = {
  type: "TimelineAddEntries";
  entries: Array<Entry>;
};

interface GraphQLSearchTimelineResponse {
  data: {
    search_by_raw_query: {
      search_timeline: { timeline: { instructions: Array<I3> } };
    };
  };
}

type QuickSearchTopic = {
  topic: string;
  rounded_score: number;
  tokens: Array<unknown>;
  inline: boolean;
};

interface QuickSearchResponse {
  num_results: number;
  completed_in: number;
  query: string;
  cashtags: Array<unknown>;
  users: Array<UserProfile>;
  topics: Array<QuickSearchTopic>;
  events: Array<unknown>;
  lists: Array<unknown>;
  ordered_sections: Array<unknown>;
  oneclick: Array<unknown>;
  hashtags: Array<unknown>;
}

// ── User profile types ──

interface RawUserResult {
  __typename: string;
  rest_id: string;
  core?: {
    created_at: string;
    name: string;
    screen_name: string;
  };
  avatar?: { image_url: string };
  verification?: { verified: boolean };
  is_blue_verified?: boolean;
  legacy?: UserLegacy;
  location?: { location: string };
  privacy?: { protected: boolean };
}

interface UserLegacy {
  description: string;
  followers_count: number;
  friends_count: number;
  statuses_count: number;
  favourites_count: number;
  listed_count: number;
  media_count: number;
  profile_banner_url?: string;
  entities?: {
    description?: {
      urls?: { expanded_url: string; display_url: string; url: string }[];
    };
    url?: {
      urls?: { expanded_url: string; display_url: string; url: string }[];
    };
  };
}

interface UserProfileData {
  id: string;
  name: string;
  screen_name: string;
  description: string;
  location: string;
  url?: string;
  created_at: string;
  followers_count: number;
  friends_count: number;
  statuses_count: number;
  favourites_count: number;
  listed_count: number;
  media_count: number;
  verified: boolean;
  is_blue_verified: boolean;
  profile_image_url: string;
  profile_banner_url?: string;
  protected: boolean;
}

interface UserProfile {
  id: number;
  id_str: string;
  verified: boolean;
  ext_is_blue_verified: boolean;
  badges: unknown[];
  is_dm_able: boolean;
  is_secret_dm_able: boolean;
  is_persona_media_genable: boolean;
  is_blocked: boolean;
  can_media_tag: boolean;
  name: string;
  screen_name: string;
  profile_image_url: string;
  profile_image_url_https: string;
  location: string;
  is_protected: boolean;
  rounded_score: number;
  social_proof: number;
  connecting_user_count: number;
  connecting_user_ids: string[];
  social_proofs_ordered: unknown[];
  social_context: {
    following: boolean;
    followed_by: boolean;
  };
  tokens: unknown[];
  inline: boolean;
  result_context: {
    display_string: string;
    types: Array<{
      type: string;
    }>;
  };
}

// ── X Post types ──

interface XPostEntities {
  urls?: { expanded_url: string; display_url: string; url: string }[];
  hashtags?: { text: string }[];
  user_mentions?: { screen_name: string; id_str: string }[];
  symbols?: { text: string }[];
}

interface XPostMediaEntity {
  media_url_https: string;
  type: string;
  expanded_url: string;
  video_info?: {
    variants: { bitrate?: number; content_type: string; url: string }[];
  };
}

interface ExtendedEntities {
  media?: XPostMediaEntity[];
}

interface XPostLegacy {
  full_text: string;
  created_at: string;
  favorite_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  bookmark_count: number;
  lang: string;
  entities: XPostEntities;
  extended_entities?: ExtendedEntities;
  in_reply_to_status_id_str?: string;
  in_reply_to_screen_name?: string;
  conversation_id_str?: string;
  retweeted_status_result?: { result: RawXPostResult };
}

interface XPostCore {
  user_results: {
    result: {
      rest_id: string;
      core?: { name: string; screen_name: string };
      avatar?: { image_url: string };
      verification?: { verified: boolean };
      is_blue_verified?: boolean;
    };
  };
}

interface NotePost {
  is_expandable: boolean;
  note_tweet_results: {
    result: {
      text: string;
      entity_set?: XPostEntities;
    };
  };
}

interface RawXPostData {
  rest_id: string;
  core: XPostCore;
  legacy: XPostLegacy;
  note_tweet?: NotePost;
  quoted_status_result?: { result?: RawXPostResult };
}

interface XPostPreviewCta {
  title: string;
  url: { url: string; urlType: string };
}

type XPostPreview = Omit<XPostLegacy, "full_text" | "lang"> & {
  text: string;
  rest_id: string;
  core: XPostCore;
};

type RawXPostResult =
  | ({ __typename: "Tweet" } & RawXPostData)
  | { __typename: "TweetWithVisibilityResults"; tweet: RawXPostData }
  | { __typename: "TweetTombstone"; tombstone?: unknown }
  | { __typename: "TweetUnavailable"; reason?: string }
  | {
      __typename: "TweetPreviewDisplay";
      cta?: XPostPreviewCta;
      tweet: XPostPreview;
    };

interface ResolvedXPost {
  id: string;
  text: string;
  created_at: string;
  lang: string;
  favorite_count: number;
  retweet_count: number;
  reply_count: number;
  quote_count: number;
  bookmark_count: number;
  author: {
    id: string;
    name: string;
    screen_name: string;
    profile_image_url: string;
    verified: boolean;
    is_blue_verified: boolean;
  };
  entities: XPostEntities;
  media?: XPostMediaEntity[];
  in_reply_to_status_id?: string;
  in_reply_to_screen_name?: string;
  conversation_id?: string;
  quoted_tweet?: ResolvedXPost;
  note_tweet_text?: string;
  retweeted_tweet: boolean;
  retweeted?: ResolvedXPost;
  link: string;
}

// ── Community types ──

interface RawCommunity {
  __typename: string;
  rest_id: string;
  name: string;
  description?: string;
  created_at: number;
  member_count: number;
  join_policy: string;
  is_nsfw: boolean;
  reason?: string;
  creator_results?: {
    result: {
      id: string;
      rest_id?: string;
      is_blue_verified?: boolean;
      core?: { name?: string; screen_name: string };
      avatar?: { image_url: string };
      verification?: { verified: boolean };
    };
  };
  custom_banner_media?: { media_info: { original_img_url: string } };
  default_banner_media?: { media_info: { original_img_url: string } };
  members_facepile_results?: {
    result: {
      id: string;
      rest_id?: string;
      avatar?: { image_url: string };
      core?: { name?: string; screen_name: string };
    };
  }[];
  rules?: { rest_id: string; name: string; description?: string }[];
  primary_community_topic?: { topic_name: string };
}

interface CommunityData {
  id: string;
  name: string;
  description?: string;
  created_at: number;
  member_count: number;
  join_policy: string;
  is_nsfw: boolean;
  topic?: string;
  banner_url?: string;
  creator: {
    id: string;
    name: string;
    screen_name: string;
    profile_image_url: string;
  };
  rules: { id: string; name: string; description?: string }[];
  members_facepile: {
    id: string;
    name: string;
    screen_name: string;
    profile_image_url: string;
  }[];
}

interface ProfileSpotlightsQuery {
  __typename: string;
  core: {
    name: string;
    screen_name: string;
  };
  id: string;
  is_verified_organization: boolean;
  privacy: {
    protected: boolean;
  };
  profilemodules: {
    v1: unknown[]; // change if structure becomes known
  };
  relationship_perspectives?: {
    blocked_by: boolean;
    blocking: boolean;
    followed_by: boolean;
    following: boolean;
  };
  rest_id: string;
}
