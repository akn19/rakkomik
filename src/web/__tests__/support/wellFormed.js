// A stand-in for an XML parser (Node ships none): markup is well-formed when every `&` starts one of the five XML
// entities, no `<` or `>` is left in the text, attribute values are quoted, and the tags are balanced.
function expectWellFormed(markup) {
    expect(markup).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
    const stack = [];
    for (const [, closing, name, , selfClosing] of markup.matchAll(
        /<(\/?)([A-Za-z][A-Za-z0-9:]*)((?:\s+[A-Za-z0-9:_-]+="[^"<>]*")*)\s*(\/?)>/g,
    )) {
        if (closing) {
            expect(stack.pop()).toBe(name);
        } else if (!selfClosing) {
            stack.push(name);
        }
    }
    expect(stack).toEqual([]);
    expect(markup.replace(/<[^>]*>/g, '')).not.toMatch(/[<>]/);
}

module.exports = { expectWellFormed };
