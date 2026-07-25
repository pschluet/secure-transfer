import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME!;

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const db = {
  tableName: TABLE_NAME,

  async get<T>(pk: string, sk: string): Promise<T | undefined> {
    const res = await client.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk } })
    );
    return res.Item as T | undefined;
  },

  async put<T extends object>(item: T): Promise<void> {
    await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  },

  async delete(pk: string, sk: string): Promise<void> {
    await client.send(
      new DeleteCommand({ TableName: TABLE_NAME, Key: { pk, sk } })
    );
  },

  async queryByPk<T>(pk: string, skPrefix?: string): Promise<T[]> {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: skPrefix
          ? "pk = :pk AND begins_with(sk, :skPrefix)"
          : "pk = :pk",
        ExpressionAttributeValues: skPrefix
          ? { ":pk": pk, ":skPrefix": skPrefix }
          : { ":pk": pk },
      })
    );
    return (res.Items ?? []) as T[];
  },

  async queryGsi1<T>(gsi1pk: string): Promise<T[]> {
    const res = await client.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :gsi1pk",
        ExpressionAttributeValues: { ":gsi1pk": gsi1pk },
      })
    );
    return (res.Items ?? []) as T[];
  },

  async update(
    pk: string,
    sk: string,
    updateExpression: string,
    values: Record<string, unknown>,
    names?: Record<string, string>,
    options?: {
      condition?: string;
      returnValues?: "NONE" | "ALL_NEW" | "UPDATED_NEW";
    }
  ): Promise<Record<string, unknown> | undefined> {
    const res = await client.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames: names,
        ConditionExpression: options?.condition,
        ReturnValues: options?.returnValues,
      })
    );
    return res.Attributes;
  },
};
