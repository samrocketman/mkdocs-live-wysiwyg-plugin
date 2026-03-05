# Known diff quirks

* HTML comments tend to always append a newline.  For now, this is the way it is
  due to complexity.
* Inline code blocks will rerender as single line because the mode switching
  can't handle the content conversion while preserving the newline.  This is a
  complex enough bug that I'm leaving it alone for now.
* Custom HTML is marked as read only.  Any markdown inside of custom HTML is not
  rendered.  This is to prioritize preserving the custom HTML rather than giving
  the user the option to edit it.  I couldn't figure out how to not have severe
  corruption.
