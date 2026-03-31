; Reference tag extraction for JavaScript.

; Function/method calls
(call_expression
  function: (identifier) @name.reference)

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference))

; new Foo()
(new_expression
  constructor: (identifier) @name.reference)
