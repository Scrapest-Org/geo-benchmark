import type { Request, Response } from "express";
import { parse } from "valibot";
import {
  XUsernameSchema,
  XPostIDSchema,
  SearchQuerySchema,
  SearchCountSchema,
  SearchCursorSchema,
  ResultTypesSchema,
} from "../utils/valibot";
import { handleError } from "../utils/express";
import { AppService } from "../services/app";

export class XController {
  constructor(private readonly app: AppService) {}

  public getUser = async (req: Request, res: Response) => {
    try {
      const username = parse(XUsernameSchema, req.query.username);
      const user = await this.app.getUser(username);

      return res.status(200).json(user);
    } catch (error) {
      return handleError(res, error);
    }
  };

  public getPost = async (req: Request, res: Response) => {
    try {
      const postId = parse(XPostIDSchema, req.query.id ?? req.query.tweetId);
      const post = await this.app.getPost(postId);

      return res.status(200).json(post);
    } catch (error) {
      return handleError(res, error);
    }
  };

  public searchPosts = async (req: Request, res: Response) => {
    try {
      const query = parse(SearchQuerySchema, req.query.q);
      const count = req.query.count
        ? parse(SearchCountSchema, Number(req.query.count))
        : 20;
      const cursor = req.query.cursor
        ? parse(SearchCursorSchema, req.query.cursor as string)
        : undefined;

      const results = await this.app.searchPosts(query, count, cursor);
      return res.status(200).json(results);
    } catch (error) {
      return handleError(res, error);
    }
  };

  public quickSearch = async (req: Request, res: Response) => {
    try {
      const query = parse(SearchQuerySchema, req.query.q);
      const resultTypes = req.query.resultTypes
        ? String(req.query.resultTypes)
            .split(",")
            .map((t) => parse(ResultTypesSchema, t.trim()))
        : undefined;

      const results = await this.app.quickSearch(query, resultTypes);
      return res.status(200).json(results);
    } catch (error) {
      return handleError(res, error);
    }
  };
}
