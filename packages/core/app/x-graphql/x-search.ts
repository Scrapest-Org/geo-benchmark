import { bunFetch } from "@scrapest/axios";
import {
  QUERY_IDS,
  SEARCH_TIMELINE_FEATURES,
} from "../../constants/graphql-constants";
import type GuestTokenManager from "../guest-token-manager";
import { XGQLInternal } from "./internal";

type ResultTypes = "cashtags" | "events" | "users" | "topics" | "lists";
const fetch = bunFetch({ baseUrl: "https://x.com" });

export class XGQLSearch extends XGQLInternal {
  private defaultResultTypes = "cashtags,events,users,topics,lists";
  constructor(guestTokenManager: GuestTokenManager) {
    super(guestTokenManager);
  }

  async search(
    q: string,
    headers: Record<any, any>,
    count = 20,
    cursor?: string,
  ) {
    const variables = JSON.stringify({
      rawQuery: q,
      count: count,
      querySource: "typeahead_click",
      product: "Top",
      withGrokTranslatedBio: true,
    });
    const features = JSON.stringify(SEARCH_TIMELINE_FEATURES);
    const params = new URLSearchParams({ variables, features });

    const path = `/i/api/graphql/${QUERY_IDS.SearchTimeline}/SearchTimeline`;
    const { data } = await this.apiQuery<GraphQLSearchTimelineResponse>(
      path,
      params,
      headers,
    );

    const raw =
      data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    const entries: Entry[] = raw
      .filter((i) => i.type === "TimelineAddEntries")
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

  async quickSearch(
    q: string,
    headers: Record<any, any>,
    resultTypes?: ResultTypes[],
  ) {
    const variables = new URLSearchParams({
      include_ext_is_blue_verified: "1",
      include_ext_verified_type: "1",
      include_ext_profile_image_shape: "1",
      q,
      src: "search_box",
      result_type: resultTypes?.join(",") || this.defaultResultTypes,
    });

    const path = `/i/api/1.1/search/typeahead.json`;
    const data = await this.apiQuery<QuickSearchResponse>(
      path,
      variables,
      headers,
    );

    return Object.fromEntries(
      Object.entries(data).filter(
        ([_, value]) => !Array.isArray(value) || value.length > 0,
      ),
    );
  }

  private async apiQuery<T>(
    path: string,
    params: URLSearchParams,
    auth: object,
  ): Promise<T> {
    const headers = await this.buildAuthHeaders("GET", path, auth);
    const res = await fetch(path, { headers, params });

    if (!res.ok)
      throw new Error(`Search Error ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }
}
