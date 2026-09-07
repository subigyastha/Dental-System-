UPDATE "ClientCreationReceipt"
SET "response" = jsonb_strip_nulls(
  jsonb_build_object(
    'id', "response" -> 'id',
    'clientCode', "response" -> 'clientCode',
    'identityReview', "response" -> 'identityReview'
  )
);
