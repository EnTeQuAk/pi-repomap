; Reference tag extraction for Go.

; Function/method calls
(call_expression
  function: (identifier) @name.reference)

(call_expression
  function: (selector_expression
    field: (field_identifier) @name.reference))

; Type references
(type_identifier) @name.reference
